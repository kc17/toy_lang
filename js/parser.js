import {Stack} from './util.js';
import {Value, Void} from './ast/value.js';
import {Func, Return, FunCall, FunCallWrapper} from './ast/function.js';
import {BINARY_OPERATORS, UNARY_OPERATORS} from './ast/operator.js';
import {Variable, Assign, While, If, StmtSequence} from './ast/statement.js';
export {Parser};

class Parser {
    constructor(environment) {
        this.environment = environment;  
    }

    parse(tokenizer) {
        try {
            return LINE_PARSERS.get('sequence').parse(tokenizer.lines());
        }
        catch(ex) {
            this.environment.output(ex);
            throw ex;
        }
    }
}

class LineParserInterceptor {
    constructor(parser) {
        this.parser = parser;
    }

    parse(lines) {
        try {
            return this.parser.parse(lines);
        } 
        catch(ex) {
            if(ex instanceof SyntaxError) {
                throw ex;
            }
            
            throw new SyntaxError(`\n\t${lines[0].toString()}`);
        }
    }
}

const LINE_PARSERS = new Map([
    ['sequence', new LineParserInterceptor({
        parse(lines) {
            if(lines.length === 0 || lines[0].code === 'else' || lines[0].code === 'end') {
                return StmtSequence.EMPTY;
            }
    
            return LINE_PARSERS.get('assign').parse(lines);   
        }
    })], 
    ['assign', {
        parse(lines) {
            let matched = lines[0].tryTokenize('assign');
            if(matched.length !== 0) {
                let [varToken, assignedToken] = matched;
                return new StmtSequence(
                    new Assign(
                        new Variable(varToken.value), 
                        VALUE_PART_PARSERS.get('value').parse(assignedToken)
                    ),
                    LINE_PARSERS.get('sequence').parse(lines.slice(1))
                );
            }

            return LINE_PARSERS.get('funcall').parse(lines);
        }
    }],      
    ['funcall', {
        parse(lines) {
            let matched = lines[0].tryTokenize('funcall');
            if(matched.length !== 0) {
                let [funcNameToken, ...argTokens] = matched;
                return new StmtSequence(
                    new FunCallWrapper(
                        new FunCall(
                            new Variable(funcNameToken.value),
                            argTokens.map(argToken => VALUE_PART_PARSERS.get('value').parse(argToken)) 
                        )
                    ),
                    LINE_PARSERS.get('sequence').parse(lines.slice(1))
                );                
            }

            return LINE_PARSERS.get('command').parse(lines);
        }
    }],        
    ['command', {
        parse(lines) {
            let [cmdToken, argToken] = lines[0].tryTokenize('command');
            switch(cmdToken.value) {
                case 'def':
                    return createAssignFunc(lines, argToken);
                case 'return':
                    return createReturn(lines, argToken);
                case 'if':
                    return createIf(lines, argToken);
                case 'while':
                    return createWhile(lines, argToken);
            }
            throw new SyntaxError(`\n\t${lines[0].toString()}`);
        }
    }]
]);

function createAssignFunc(lines, argToken) {
    let [funcNameToken, ...paramTokens] = argToken.tryTokenize('func');
    let remains = lines.slice(1);     
    return new StmtSequence(
        new Assign(
            new Variable(funcNameToken.value), 
            new Func(
                paramTokens.map(paramToken => new Variable(paramToken.value)), 
                LINE_PARSERS.get('sequence').parse(remains)
            )
        ),
        LINE_PARSERS.get('sequence').parse(linesAfterCurrentBlock(remains))
    );    
}

function createReturn(lines, argToken) { 
    return new StmtSequence(
        new Return(argToken.value === '' ? Void : VALUE_PART_PARSERS.get('value').parse(argToken)),
        LINE_PARSERS.get('sequence').parse(lines.slice(1))
    );
}

function createIf(lines, argToken) {
    let remains = lines.slice(1);     
    let trueStmt = LINE_PARSERS.get('sequence').parse(remains);

    let i = matchingElseIdx(trueStmt);
    let falseStmt = remains[i].code === 'else' ? 
            LINE_PARSERS.get('sequence').parse(remains.slice(i + 1)) : 
            StmtSequence.EMPTY;

    return new StmtSequence(
            new If(
                VALUE_PART_PARSERS.get('boolean').parse(argToken), 
                trueStmt,
                falseStmt
            ),
            LINE_PARSERS.get('sequence').parse(linesAfterCurrentBlock(remains))
    );
}

function createWhile(lines, argToken) {
    let remains = lines.slice(1);     
    return new StmtSequence(
         new While(
            VALUE_PART_PARSERS.get('boolean').parse(argToken), 
            LINE_PARSERS.get('sequence').parse(remains)
         ),
         LINE_PARSERS.get('sequence').parse(linesAfterCurrentBlock(remains))
    ); 
}

function matchingElseIdx(stmt, i = 1) {
    if(stmt.secondStmt === StmtSequence.EMPTY) {
        return i;
    }
    return matchingElseIdx(stmt.secondStmt, i + 1);
}

function linesAfterCurrentBlock(lines, endCount = 1) {
    if(endCount === 0) {
        return lines;
    }

    let code = lines[0].code;
    let n = (code.startsWith('if') || code.startsWith('while') || code.startsWith('def')) ? endCount + 1 : (
        code === 'end' ? endCount - 1 : endCount
    );

    return linesAfterCurrentBlock(lines.slice(1), n);
}

const VALUE_PART_PARSERS = new Map([
    ['value', {
        parse(token) {
            // pattern matching from text
            return VALUE_PART_PARSERS.get('text').parse(token);
        }
    }],
    ['text', {
        parse(token) {
            let [textToken] = token.tryTokenize('text');
            return textToken ? 
                      new Value(textToken.value
                                          .replace(/^\\r/, '\r')
                                          .replace(/^\\n/, '\n')
                                          .replace(/([^\\])\\r/g, '$1\r')
                                          .replace(/([^\\])\\n/g, '$1\n')
                                          .replace(/^\\t/, '\t')
                                          .replace(/([^\\])\\t/g, '$1\t')
                                          .replace(/\\\\/g, '\\')
                                          .replace(/\\'/g, '\'')
                      ) 
                      : VALUE_PART_PARSERS.get('number').parse(token);
        }
    }],
    ['number', {
        parse(token) {
            let [numToken] = token.tryTokenize('number');
            return numToken ? new Value(parseFloat(numToken.value)) : VALUE_PART_PARSERS.get('boolean').parse(token);
        }        
    }],
    ['boolean', {
        parse(token) {
            let [boolToken] = token.tryTokenize('boolean');
            return boolToken ? new Value(boolToken.value === 'true') : VALUE_PART_PARSERS.get('variable').parse(token);
        }        
    }],    
    ['variable', {
        parse(token) {
            let [varToken] = token.tryTokenize('variable');
            return varToken ? new Variable(varToken.value) : VALUE_PART_PARSERS.get('funcall').parse(token);
        }
    }],
    ['funcall', {
        parse(token) {
            let funcallTokens = token.tryTokenize('funcall');
            if(funcallTokens.length !== 0) {
                let [fNameToken, ...argTokens] = funcallTokens;
                return new FunCall(
                    new Variable(fNameToken.value), 
                    argTokens.map(argToken => VALUE_PART_PARSERS.get('value').parse(argToken))
                )
            }

            return VALUE_PART_PARSERS.get('expression').parse(token);
        }        
    }],    
    ['expression', {
        parse(token) {
            let tokens = toPostfix(token.tryTokenize('expression'));
            return tokens.reduce((stack, token) => {
                if(isOperator(token.value)) {
                    return reduce(stack, token.value);
                } 
                else if(token.value.startsWith('not')) {
                    let [unaryToken, operandToken] = token.tryTokenize('not');
                    let NotOperator = UNARY_OPERATORS.get(unaryToken.value);
                    return stack.push(
                        new NotOperator(
                            VALUE_PART_PARSERS.get('value').parse(operandToken)
                        )
                    );
                }
                return stack.push(
                    VALUE_PART_PARSERS.get('value').parse(token)
                );
            }, new Stack()).top;
        }
    }]
]);

// expression

function priority(operator) {
    return ['==', '!=', '>=', '>', '<=', '<'].indexOf(operator) !== -1 ? 4 : 
           ['and', 'or'].indexOf(operator) !== -1 ? 3 :
           ['*', '/', '%'].indexOf(operator) !== -1 ? 2 :
           ['+', '-'].indexOf(operator) !== -1 ? 1 : 0;
}

function popHighPriority(token, stack, output) {
    if(!stack.isEmpty() && priority(stack.top.value) >= priority(token.value)) {
        return popHighPriority(token, stack.pop(), output.concat([stack.top]));
    }
    return [stack, output];
}

function popAllBeforeLP(stack, output) {
    if(stack.top.value !== '(') {
        return popAllBeforeLP(stack.pop(), output.concat([stack.top]));
    }
    return [stack, output];
}

function digest(tokens, stack = new Stack(), output = []) {
    if(tokens.length === 0) {
        return [stack, output];
    }

    switch(tokens[0].value) {
        case '(':
            return digest(tokens.slice(1), stack.push(tokens[0]), output);
        case '==': case '!=': case '>=': case '>': case '<=': case '<':
        case 'and': case 'or':
        case '+': case '-': case '*': case '/': case '%':
            let [s1, o1] = popHighPriority(tokens[0], stack, output);
            return digest(tokens.slice(1), s1.push(tokens[0]), o1);
        case ')':
            let [s2, o2] = popAllBeforeLP(stack, output);
            return digest(tokens.slice(1), s2.pop(), o2);
        default: 
            return digest(tokens.slice(1), stack, output.concat([tokens[0]]));
    }
}

function popAll(stack, output) {
    if(stack.isEmpty()) {
        return output;
    }
    return popAll(stack.pop(), output.concat([stack.top]));
}

function toPostfix(tokens) {
    let [stack, output] = digest(tokens);
    return popAll(stack, output);
}

function isOperator(tokenValue) {        
    return ['==', '!=', '>=', '>', '<=', '<',
            'and', 'or', 
            '+', '-', '*', '/', '%'].indexOf(tokenValue) !== -1;
}

function reduce(stack, tokenValue) {
    let right = stack.top;
    let s1 = stack.pop();
    let left = s1.top;
    let s2 = s1.pop();
    let Operator = BINARY_OPERATORS.get(tokenValue);
    return s2.push(new Operator(left, right));
}