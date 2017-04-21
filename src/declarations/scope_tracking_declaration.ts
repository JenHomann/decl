import { Declaration } from './declaration';
import { ElementMatcher } from '../element_collector';
import { Scope, ScopeExecutor } from '../scope';

export { ElementMatcher, ScopeExecutor };

export abstract class ScopeTrackingDeclaration extends Declaration {
    protected readonly childScopes: Scope[] = [];
    
    deactivate(): void {
        this.removeAllChildScopes();
        super.deactivate();
    }

    getChildScopes() {
        return this.childScopes;
    }

    protected addChildScope(scope: Scope) {
        if(this.isActivated) {
            this.childScopes.push(scope);

            scope.activate();
        }
    }

    protected removeChildScope(scope: Scope) { 
        scope.deactivate();

        if(this.isActivated) {
            let index = this.childScopes.indexOf(scope);
            
            if(index >= 0) {
                this.childScopes.splice(index, 1);
            }
        }
    }

    protected removeAllChildScopes() {
        let childScope: Scope;

        while(childScope = this.childScopes[0]) {
            this.removeChildScope(childScope);
        }
    }

    protected addChildScopeByElement(element: Element, executor?: ScopeExecutor) {
        let childScope = new Scope(element, executor);

        this.addChildScope(childScope);
    }

    protected removeChildScopeByElement(element: Element) {
        for(let childScope of this.childScopes) {
            if(childScope.getElement() === element) {
                this.removeChildScope(childScope);
                return; // loop must exist to avoid data-race
            }
        }
    }
}