import { Subscription, SubscriptionExecutor } from './subscriptions/subscription';
import { TrivialSubscription } from './subscriptions/trivial_subscription';
import { MatchingElementsSubscription, MatchingElementsChangedEvent } from './subscriptions/matching_elements_subscription';
import { ElementMatchesSubscription, ElementMatchesChangedEvent, ElementMatcher } from './subscriptions/element_matches_subscription';
import { EventSubscription, EventMatcher } from './subscriptions/event_subscription';

export class Scope {
    static buildRootScope(element: Element): Scope {
        let scope = new Scope(null, '<<root>>', element, null);

        scope.activate();

        return scope;
    }

    private readonly parentScope: Scope;
    private readonly childScopes: Scope[] = [];    
    private readonly element: Element;
    private readonly name: string;

    private isActivated: boolean = false;
    private subscriptions: Subscription[] = [];

    constructor(parentScope: Scope, name: string, element: Element, executor?: ScopeExecutor) {
        this.parentScope = parentScope;
        this.name = name;
        this.element = element;

        if(executor) {
            executor.call(this, this, this.element);
        }
    }

    getParentScope(): Scope {
        return this.parentScope;
    }

    getChildScopes(): Scope[] {
        return this.childScopes;
    }

    collectDescendantScopes(): Scope[] {
        let scopes: Scope[] = [];

        for(let scope of this.childScopes) {
            scopes.push(scope, ...scope.collectDescendantScopes());
        }

        return scopes;
    }

    drawTree(): string {
        return this.drawTreeLines().join('\n');
    }

    drawTreeLines(): string[] {
        let lines: string[] = [];

        let self = this.name + ' (' + this.subscriptions.length + ')';

        if(this.childScopes.length > 0) {
            lines.push(self + ' {');

            for(let scope of this.childScopes) {
                for(let line of scope.drawTreeLines()) {
                    lines.push('\t' + line);
                }
            }

            lines.push('}');
        }else{
            lines.push(self);
        }

        return lines;
    }

    getElement(): Element {
        return this.element;
    }

    match(executor: SubscriptionExecutor): Scope {
        this.addSubscription(new TrivialSubscription(this.element, { connected: true }, executor));

        return this;
    }

    unmatch(executor: SubscriptionExecutor): Scope {
        this.addSubscription(new TrivialSubscription(this.element, { disconnected: true }, executor));

        return this;
    }

    select(matcher: ElementMatcher, executor: ScopeExecutor): Scope {
        this.addSubscription(new MatchingElementsSubscription(this.element, matcher, this.buildSelectExecutor(String(matcher), executor)));

        return this;
    }

    when(matcher: ElementMatcher, executor: ScopeExecutor): Scope {
		this.addSubscription(new ElementMatchesSubscription(this.element, matcher, this.buildWhenExecutor(String(matcher), executor)));

        return this;
    }

    on(eventMatcher: EventMatcher, executor: SubscriptionExecutor): Scope;
    on(eventMatcher: EventMatcher, elementMatcher: ElementMatcher, executor: SubscriptionExecutor): Scope;
    on(eventMatcher: EventMatcher, executorOrElementMatcher: SubscriptionExecutor | ElementMatcher, maybeExecutor?: SubscriptionExecutor): Scope {
        let argumentsCount = arguments.length;

        switch(argumentsCount) {
            case 2:
                return this.onWithTwoArguments(eventMatcher, <SubscriptionExecutor>executorOrElementMatcher);
            case 3:
                return this.onWithThreeArguments(eventMatcher, <ElementMatcher>executorOrElementMatcher, <SubscriptionExecutor>maybeExecutor);
            default:
                throw new TypeError("Failed to execute 'on' on 'Scope': 2 or 3 arguments required, but " + argumentsCount + " present.");
        }
    }

    private onWithTwoArguments(eventMatcher: EventMatcher, executor: SubscriptionExecutor): Scope {
        this.addSubscription(new EventSubscription(this.element, eventMatcher, executor));

        return this;
    }

    private onWithThreeArguments(eventMatcher: EventMatcher, elementMatcher: ElementMatcher, executor: SubscriptionExecutor): Scope {
        this.select(elementMatcher, (scope) => {
            scope.on(eventMatcher, executor)
        });

        return this;
    }
    
    // This method is for testing
    pristine(): void {
        for(let subscription of this.subscriptions) {
            subscription.disconnect();
        }
        
        this.subscriptions.splice(0);
    }

    protected activate(): void {
        if(!this.isActivated) {
            this.isActivated = true;

            for(let subscription of this.subscriptions) {
                subscription.connect();
            }
        }
    }

    protected deactivate(): void {
        if(this.isActivated) {
            for(let subscription of this.subscriptions) {
                subscription.disconnect();
            }

            let orphanedChildScope;
            while(orphanedChildScope = this.childScopes[0]) {
                console.warn('Decl bug!', this, 'attempted to deactivate without cleaning up', orphanedChildScope);
                this.destroyChildScope(orphanedChildScope);
            }

            this.isActivated = false;            
        }
    }

    private addSubscription(subscription: Subscription): void {
        this.subscriptions.push(subscription);

        if(this.isActivated) {
            subscription.connect();
        }
    }

    private removeSubscription(subscription: Subscription): void {
        var index = this.subscriptions.indexOf(subscription);

        if(index >= 0) {
            subscription.disconnect();

            this.subscriptions.splice(index, 1);
        }
    }

    private buildSelectExecutor(name: string, executor: ScopeExecutor): SubscriptionExecutor {
        let scopes: Scope[] = [];

        return (event: MatchingElementsChangedEvent, element: Element) => {
            for(let element of event.addedElements) {
                let scope = this.createChildScope(name, element, executor);

                scopes.push(scope);
            }

            for(let element of event.removedElements) {
                for(let index = 0, length = scopes.length, scope : Scope; index < length; index++) {
                    scope = scopes[index];

                    if(scope.element === element) {
                        this.destroyChildScope(scope);
                        
                        scopes.splice(index, 1);
                        break;
                    }
                }
            }
        };
    }

    private buildWhenExecutor(name: string, executor: ScopeExecutor): SubscriptionExecutor {
        let scope : Scope = null;

        return (event: ElementMatchesChangedEvent, element: Element) => {
            if(event.isMatching) {
                scope = this.createChildScope('&' + name, this.element, executor);
            }else{
                this.destroyChildScope(scope);
                scope = null;
            }
        };
    }

    private createChildScope(name: string, element: Element, executor?: ScopeExecutor): Scope {
        let scope = new Scope(this, name, element, executor);
        this.childScopes.push(scope);

        scope.activate();

        return scope;
    }

    private destroyChildScope(scope: Scope) {
        let index = this.childScopes.indexOf(scope);

        scope.deactivate();

        if(index >= 0) {
            this.childScopes.splice(index, 1);
        }
    }
}

export interface ScopeExecutor { (scope: Scope, element: Element): void };
export { ElementMatcher, EventMatcher, SubscriptionExecutor };
