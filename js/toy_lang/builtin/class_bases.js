import {Value, Primitive, Class, Instance, Void, Null} from '../interpreter/ast/value.js';
import {StmtSequence} from '../interpreter/ast/statement.js';

import {PARAM_LT0} from './func_bases.js';
import {func} from './func_bases.js';

export {Native, clzNode, methodPrimitive, methodVoid, methodSelf, methodNewSameType, self, selfInternalValue};

class Native extends Value {
    constructor(value) {
        super();
        this.value = value;
    }

    toString() {
        return `${this.value}`;
    }
}

function clzNode(name, methods, parents) {
    return new Class(StmtSequence.EMPTY, methods, name, parents);
}

function self(context) {
    return context.variables.get('this');
}

function selfInternalValue(context) {
    return self(context).internalNode.value;
}

function delegate(context, nativeClz, methodName, params) {
    return nativeClz.prototype[methodName].apply(
        selfInternalValue(context), 
        params.map(param => param.evaluate(context).value)
    );
}

function methodPrimitive(nativeClz, methodName, params = PARAM_LT0) {
    return func(methodName, {
        evaluate(context) {
            return context.returned(
                Primitive.from(
                    delegate(context, nativeClz, methodName, params)
                )
            );
        }
    }, params);
}

function methodVoid(nativeClz, methodName, params = PARAM_LT0) {
    return func(methodName, {
        evaluate(context) {
            delegate(context, nativeClz, methodName, params);
            return context.returned(Void);
            
        }    
    }, params);
}

function methodSelf(nativeClz, methodName, params = PARAM_LT0) {
    return func(methodName, {
        evaluate(context) {
            const value = delegate(context, nativeClz, methodName, params);
            const instance = self(context);
            instance.internalNode = new Native(value);
            return context.returned(instance);
        }
    }, params);
}

function methodNewSameType(nativeClz, methodName, params = PARAM_LT0) {
    return func(methodName, {
        evaluate(context) {
            const value = delegate(context, nativeClz, methodName, params);
            const origin = self(context);
            return context.returned(
                new Instance(
                    origin.clzOfLang, 
                    new Map(origin.properties), 
                    new Native(value)
                )
            );
        }
    }, params);
}
