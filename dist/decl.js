(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var MutationObserver = window.MutationObserver
  || window.WebKitMutationObserver
  || window.MozMutationObserver;

/*
 * Copyright 2012 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

var WeakMap = window.WeakMap;

if (typeof WeakMap === 'undefined') {
  var defineProperty = Object.defineProperty;
  var counter = Date.now() % 1e9;

  WeakMap = function() {
    this.name = '__st' + (Math.random() * 1e9 >>> 0) + (counter++ + '__');
  };

  WeakMap.prototype = {
    set: function(key, value) {
      var entry = key[this.name];
      if (entry && entry[0] === key)
        entry[1] = value;
      else
        defineProperty(key, this.name, {value: [key, value], writable: true});
      return this;
    },
    get: function(key) {
      var entry;
      return (entry = key[this.name]) && entry[0] === key ?
          entry[1] : undefined;
    },
    'delete': function(key) {
      var entry = key[this.name];
      if (!entry) return false;
      var hasValue = entry[0] === key;
      entry[0] = entry[1] = undefined;
      return hasValue;
    },
    has: function(key) {
      var entry = key[this.name];
      if (!entry) return false;
      return entry[0] === key;
    }
  };
}

var registrationsTable = new WeakMap();

// We use setImmediate or postMessage for our future callback.
var setImmediate = window.msSetImmediate;

// Use post message to emulate setImmediate.
if (!setImmediate) {
  var setImmediateQueue = [];
  var sentinel = String(Math.random());
  window.addEventListener('message', function(e) {
    if (e.data === sentinel) {
      var queue = setImmediateQueue;
      setImmediateQueue = [];
      queue.forEach(function(func) {
        func();
      });
    }
  });
  setImmediate = function(func) {
    setImmediateQueue.push(func);
    window.postMessage(sentinel, '*');
  };
}

// This is used to ensure that we never schedule 2 callas to setImmediate
var isScheduled = false;

// Keep track of observers that needs to be notified next time.
var scheduledObservers = [];

/**
 * Schedules |dispatchCallback| to be called in the future.
 * @param {MutationObserver} observer
 */
function scheduleCallback(observer) {
  scheduledObservers.push(observer);
  if (!isScheduled) {
    isScheduled = true;
    setImmediate(dispatchCallbacks);
  }
}

function wrapIfNeeded(node) {
  return window.ShadowDOMPolyfill &&
      window.ShadowDOMPolyfill.wrapIfNeeded(node) ||
      node;
}

function dispatchCallbacks() {
  // http://dom.spec.whatwg.org/#mutation-observers

  isScheduled = false; // Used to allow a new setImmediate call above.

  var observers = scheduledObservers;
  scheduledObservers = [];
  // Sort observers based on their creation UID (incremental).
  observers.sort(function(o1, o2) {
    return o1.uid_ - o2.uid_;
  });

  var anyNonEmpty = false;
  observers.forEach(function(observer) {

    // 2.1, 2.2
    var queue = observer.takeRecords();
    // 2.3. Remove all transient registered observers whose observer is mo.
    removeTransientObserversFor(observer);

    // 2.4
    if (queue.length) {
      observer.callback_(queue, observer);
      anyNonEmpty = true;
    }
  });

  // 3.
  if (anyNonEmpty)
    dispatchCallbacks();
}

function removeTransientObserversFor(observer) {
  observer.nodes_.forEach(function(node) {
    var registrations = registrationsTable.get(node);
    if (!registrations)
      return;
    registrations.forEach(function(registration) {
      if (registration.observer === observer)
        registration.removeTransientObservers();
    });
  });
}

/**
 * This function is used for the "For each registered observer observer (with
 * observer's options as options) in target's list of registered observers,
 * run these substeps:" and the "For each ancestor ancestor of target, and for
 * each registered observer observer (with options options) in ancestor's list
 * of registered observers, run these substeps:" part of the algorithms. The
 * |options.subtree| is checked to ensure that the callback is called
 * correctly.
 *
 * @param {Node} target
 * @param {function(MutationObserverInit):MutationRecord} callback
 */
function forEachAncestorAndObserverEnqueueRecord(target, callback) {
  for (var node = target; node; node = node.parentNode) {
    var registrations = registrationsTable.get(node);

    if (registrations) {
      for (var j = 0; j < registrations.length; j++) {
        var registration = registrations[j];
        var options = registration.options;

        // Only target ignores subtree.
        if (node !== target && !options.subtree)
          continue;

        var record = callback(options);
        if (record)
          registration.enqueue(record);
      }
    }
  }
}

var uidCounter = 0;

/**
 * The class that maps to the DOM MutationObserver interface.
 * @param {Function} callback.
 * @constructor
 */
function JsMutationObserver(callback) {
  this.callback_ = callback;
  this.nodes_ = [];
  this.records_ = [];
  this.uid_ = ++uidCounter;
}

JsMutationObserver.prototype = {
  observe: function(target, options) {
    target = wrapIfNeeded(target);

    // 1.1
    if (!options.childList && !options.attributes && !options.characterData ||

        // 1.2
        options.attributeOldValue && !options.attributes ||

        // 1.3
        options.attributeFilter && options.attributeFilter.length &&
            !options.attributes ||

        // 1.4
        options.characterDataOldValue && !options.characterData) {

      throw new SyntaxError();
    }

    var registrations = registrationsTable.get(target);
    if (!registrations)
      registrationsTable.set(target, registrations = []);

    // 2
    // If target's list of registered observers already includes a registered
    // observer associated with the context object, replace that registered
    // observer's options with options.
    var registration;
    for (var i = 0; i < registrations.length; i++) {
      if (registrations[i].observer === this) {
        registration = registrations[i];
        registration.removeListeners();
        registration.options = options;
        break;
      }
    }

    // 3.
    // Otherwise, add a new registered observer to target's list of registered
    // observers with the context object as the observer and options as the
    // options, and add target to context object's list of nodes on which it
    // is registered.
    if (!registration) {
      registration = new Registration(this, target, options);
      registrations.push(registration);
      this.nodes_.push(target);
    }

    registration.addListeners();
  },

  disconnect: function() {
    this.nodes_.forEach(function(node) {
      var registrations = registrationsTable.get(node);
      for (var i = 0; i < registrations.length; i++) {
        var registration = registrations[i];
        if (registration.observer === this) {
          registration.removeListeners();
          registrations.splice(i, 1);
          // Each node can only have one registered observer associated with
          // this observer.
          break;
        }
      }
    }, this);
    this.records_ = [];
  },

  takeRecords: function() {
    var copyOfRecords = this.records_;
    this.records_ = [];
    return copyOfRecords;
  }
};

/**
 * @param {string} type
 * @param {Node} target
 * @constructor
 */
function MutationRecord(type, target) {
  this.type = type;
  this.target = target;
  this.addedNodes = [];
  this.removedNodes = [];
  this.previousSibling = null;
  this.nextSibling = null;
  this.attributeName = null;
  this.attributeNamespace = null;
  this.oldValue = null;
}

function copyMutationRecord(original) {
  var record = new MutationRecord(original.type, original.target);
  record.addedNodes = original.addedNodes.slice();
  record.removedNodes = original.removedNodes.slice();
  record.previousSibling = original.previousSibling;
  record.nextSibling = original.nextSibling;
  record.attributeName = original.attributeName;
  record.attributeNamespace = original.attributeNamespace;
  record.oldValue = original.oldValue;
  return record;
};

// We keep track of the two (possibly one) records used in a single mutation.
var currentRecord, recordWithOldValue;

/**
 * Creates a record without |oldValue| and caches it as |currentRecord| for
 * later use.
 * @param {string} oldValue
 * @return {MutationRecord}
 */
function getRecord(type, target) {
  return currentRecord = new MutationRecord(type, target);
}

/**
 * Gets or creates a record with |oldValue| based in the |currentRecord|
 * @param {string} oldValue
 * @return {MutationRecord}
 */
function getRecordWithOldValue(oldValue) {
  if (recordWithOldValue)
    return recordWithOldValue;
  recordWithOldValue = copyMutationRecord(currentRecord);
  recordWithOldValue.oldValue = oldValue;
  return recordWithOldValue;
}

function clearRecords() {
  currentRecord = recordWithOldValue = undefined;
}

/**
 * @param {MutationRecord} record
 * @return {boolean} Whether the record represents a record from the current
 * mutation event.
 */
function recordRepresentsCurrentMutation(record) {
  return record === recordWithOldValue || record === currentRecord;
}

/**
 * Selects which record, if any, to replace the last record in the queue.
 * This returns |null| if no record should be replaced.
 *
 * @param {MutationRecord} lastRecord
 * @param {MutationRecord} newRecord
 * @param {MutationRecord}
 */
function selectRecord(lastRecord, newRecord) {
  if (lastRecord === newRecord)
    return lastRecord;

  // Check if the the record we are adding represents the same record. If
  // so, we keep the one with the oldValue in it.
  if (recordWithOldValue && recordRepresentsCurrentMutation(lastRecord))
    return recordWithOldValue;

  return null;
}

/**
 * Class used to represent a registered observer.
 * @param {MutationObserver} observer
 * @param {Node} target
 * @param {MutationObserverInit} options
 * @constructor
 */
function Registration(observer, target, options) {
  this.observer = observer;
  this.target = target;
  this.options = options;
  this.transientObservedNodes = [];
}

Registration.prototype = {
  enqueue: function(record) {
    var records = this.observer.records_;
    var length = records.length;

    // There are cases where we replace the last record with the new record.
    // For example if the record represents the same mutation we need to use
    // the one with the oldValue. If we get same record (this can happen as we
    // walk up the tree) we ignore the new record.
    if (records.length > 0) {
      var lastRecord = records[length - 1];
      var recordToReplaceLast = selectRecord(lastRecord, record);
      if (recordToReplaceLast) {
        records[length - 1] = recordToReplaceLast;
        return;
      }
    } else {
      scheduleCallback(this.observer);
    }

    records[length] = record;
  },

  addListeners: function() {
    this.addListeners_(this.target);
  },

  addListeners_: function(node) {
    var options = this.options;
    if (options.attributes)
      node.addEventListener('DOMAttrModified', this, true);

    if (options.characterData)
      node.addEventListener('DOMCharacterDataModified', this, true);

    if (options.childList)
      node.addEventListener('DOMNodeInserted', this, true);

    if (options.childList || options.subtree)
      node.addEventListener('DOMNodeRemoved', this, true);
  },

  removeListeners: function() {
    this.removeListeners_(this.target);
  },

  removeListeners_: function(node) {
    var options = this.options;
    if (options.attributes)
      node.removeEventListener('DOMAttrModified', this, true);

    if (options.characterData)
      node.removeEventListener('DOMCharacterDataModified', this, true);

    if (options.childList)
      node.removeEventListener('DOMNodeInserted', this, true);

    if (options.childList || options.subtree)
      node.removeEventListener('DOMNodeRemoved', this, true);
  },

  /**
   * Adds a transient observer on node. The transient observer gets removed
   * next time we deliver the change records.
   * @param {Node} node
   */
  addTransientObserver: function(node) {
    // Don't add transient observers on the target itself. We already have all
    // the required listeners set up on the target.
    if (node === this.target)
      return;

    this.addListeners_(node);
    this.transientObservedNodes.push(node);
    var registrations = registrationsTable.get(node);
    if (!registrations)
      registrationsTable.set(node, registrations = []);

    // We know that registrations does not contain this because we already
    // checked if node === this.target.
    registrations.push(this);
  },

  removeTransientObservers: function() {
    var transientObservedNodes = this.transientObservedNodes;
    this.transientObservedNodes = [];

    transientObservedNodes.forEach(function(node) {
      // Transient observers are never added to the target.
      this.removeListeners_(node);

      var registrations = registrationsTable.get(node);
      for (var i = 0; i < registrations.length; i++) {
        if (registrations[i] === this) {
          registrations.splice(i, 1);
          // Each node can only have one registered observer associated with
          // this observer.
          break;
        }
      }
    }, this);
  },

  handleEvent: function(e) {
    // Stop propagation since we are managing the propagation manually.
    // This means that other mutation events on the page will not work
    // correctly but that is by design.
    e.stopImmediatePropagation();

    switch (e.type) {
      case 'DOMAttrModified':
        // http://dom.spec.whatwg.org/#concept-mo-queue-attributes

        var name = e.attrName;
        var namespace = e.relatedNode.namespaceURI;
        var target = e.target;

        // 1.
        var record = new getRecord('attributes', target);
        record.attributeName = name;
        record.attributeNamespace = namespace;

        // 2.
        var oldValue =
            e.attrChange === MutationEvent.ADDITION ? null : e.prevValue;

        forEachAncestorAndObserverEnqueueRecord(target, function(options) {
          // 3.1, 4.2
          if (!options.attributes)
            return;

          // 3.2, 4.3
          if (options.attributeFilter && options.attributeFilter.length &&
              options.attributeFilter.indexOf(name) === -1 &&
              options.attributeFilter.indexOf(namespace) === -1) {
            return;
          }
          // 3.3, 4.4
          if (options.attributeOldValue)
            return getRecordWithOldValue(oldValue);

          // 3.4, 4.5
          return record;
        });

        break;

      case 'DOMCharacterDataModified':
        // http://dom.spec.whatwg.org/#concept-mo-queue-characterdata
        var target = e.target;

        // 1.
        var record = getRecord('characterData', target);

        // 2.
        var oldValue = e.prevValue;


        forEachAncestorAndObserverEnqueueRecord(target, function(options) {
          // 3.1, 4.2
          if (!options.characterData)
            return;

          // 3.2, 4.3
          if (options.characterDataOldValue)
            return getRecordWithOldValue(oldValue);

          // 3.3, 4.4
          return record;
        });

        break;

      case 'DOMNodeRemoved':
        this.addTransientObserver(e.target);
        // Fall through.
      case 'DOMNodeInserted':
        // http://dom.spec.whatwg.org/#concept-mo-queue-childlist
        var target = e.relatedNode;
        var changedNode = e.target;
        var addedNodes, removedNodes;
        if (e.type === 'DOMNodeInserted') {
          addedNodes = [changedNode];
          removedNodes = [];
        } else {

          addedNodes = [];
          removedNodes = [changedNode];
        }
        var previousSibling = changedNode.previousSibling;
        var nextSibling = changedNode.nextSibling;

        // 1.
        var record = getRecord('childList', target);
        record.addedNodes = addedNodes;
        record.removedNodes = removedNodes;
        record.previousSibling = previousSibling;
        record.nextSibling = nextSibling;

        forEachAncestorAndObserverEnqueueRecord(target, function(options) {
          // 2.1, 3.2
          if (!options.childList)
            return;

          // 2.2, 3.3
          return record;
        });

    }

    clearRecords();
  }
};

if (!MutationObserver) {
  MutationObserver = JsMutationObserver;
}

module.exports = MutationObserver;

},{}],2:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var scope_1 = require("./scope");
exports.Scope = scope_1.Scope;
exports.default = Decl;
var Decl = (function () {
    function Decl(root) {
        this.scope = scope_1.Scope.buildRootScope(root);
    }
    Decl.select = function (matcher, executor) {
        return this.getDefaultInstance().select(matcher, executor);
    };
    Decl.on = function (matcher, executor) {
        return this.getDefaultInstance().on(matcher, executor);
    };
    Decl.getRootScope = function () {
        return this.getDefaultInstance().getRootScope();
    };
    Decl.inspect = function () {
        this.getDefaultInstance().inspect();
    };
    Decl.getDefaultInstance = function () {
        return this.defaultInstance || (this.defaultInstance = new Decl(document.documentElement));
    };
    Decl.setDefaultInstance = function (decl) {
        return this.defaultInstance = decl;
    };
    Decl.pristine = function () {
        if (this.defaultInstance) {
            this.defaultInstance.pristine();
            this.defaultInstance = null;
        }
    };
    Decl.prototype.select = function (matcher, executor) {
        return this.scope.select(matcher, executor);
    };
    Decl.prototype.on = function (matcher, executor) {
        return this.scope.on(matcher, executor);
    };
    Decl.prototype.getRootScope = function () {
        return this.scope;
    };
    Decl.prototype.inspect = function () {
        this.scope.inspect();
    };
    Decl.prototype.pristine = function () {
        this.scope.pristine();
    };
    return Decl;
}());
Decl.defaultInstance = null;
exports.Decl = Decl;
// Export to a global for the browser (there *has* to be a better way to do this!)
if (typeof (window) !== 'undefined') {
    window.Decl = Decl;
}

},{"./scope":11}],3:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Declaration = (function () {
    function Declaration(element) {
        this.isActivated = false;
        this.element = element;
    }
    Declaration.prototype.activate = function () {
        if (!this.isActivated) {
            this.isActivated = true;
            this.subscription.connect();
        }
    };
    Declaration.prototype.deactivate = function () {
        if (this.isActivated) {
            this.isActivated = false;
            this.subscription.disconnect();
        }
    };
    return Declaration;
}());
exports.Declaration = Declaration;

},{}],4:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var declaration_1 = require("./declaration");
var trivial_subscription_1 = require("../subscriptions/trivial_subscription");
var MatchDeclaration = (function (_super) {
    __extends(MatchDeclaration, _super);
    function MatchDeclaration(element, executor) {
        var _this = _super.call(this, element) || this;
        _this.executor = executor;
        _this.subscription = new trivial_subscription_1.TrivialSubscription(_this.element, { connected: true }, _this.executor);
        return _this;
    }
    MatchDeclaration.prototype.inspect = function () {
        console.log('fires', this.executor, 'when the element enters the DOM (matches)');
    };
    return MatchDeclaration;
}(declaration_1.Declaration));
exports.MatchDeclaration = MatchDeclaration;

},{"../subscriptions/trivial_subscription":17,"./declaration":3}],5:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var declaration_1 = require("./declaration");
var event_subscription_1 = require("../subscriptions/event_subscription");
var OnDeclaration = (function (_super) {
    __extends(OnDeclaration, _super);
    function OnDeclaration(element, matcher, executor) {
        var _this = _super.call(this, element) || this;
        _this.matcher = matcher;
        _this.executor = executor;
        _this.subscription = new event_subscription_1.EventSubscription(_this.element, _this.matcher, _this.executor);
        return _this;
    }
    OnDeclaration.prototype.inspect = function () {
        console.log('fires', this.executor, 'on', this.matcher);
    };
    return OnDeclaration;
}(declaration_1.Declaration));
exports.OnDeclaration = OnDeclaration;

},{"../subscriptions/event_subscription":14,"./declaration":3}],6:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var declaration_1 = require("./declaration");
var scope_1 = require("../scope");
var ScopeTrackingDeclaration = (function (_super) {
    __extends(ScopeTrackingDeclaration, _super);
    function ScopeTrackingDeclaration() {
        var _this = _super !== null && _super.apply(this, arguments) || this;
        _this.childScopes = [];
        return _this;
    }
    ScopeTrackingDeclaration.prototype.deactivate = function () {
        this.removeAllChildScopes();
        _super.prototype.deactivate.call(this);
    };
    ScopeTrackingDeclaration.prototype.getChildScopes = function () {
        return this.childScopes;
    };
    ScopeTrackingDeclaration.prototype.addChildScope = function (scope) {
        if (this.isActivated) {
            this.childScopes.push(scope);
            scope.activate();
        }
    };
    ScopeTrackingDeclaration.prototype.removeChildScope = function (scope) {
        scope.deactivate();
        if (this.isActivated) {
            var index = this.childScopes.indexOf(scope);
            if (index >= 0) {
                this.childScopes.splice(index, 1);
            }
        }
    };
    ScopeTrackingDeclaration.prototype.removeAllChildScopes = function () {
        var childScope;
        while (childScope = this.childScopes[0]) {
            this.removeChildScope(childScope);
        }
    };
    ScopeTrackingDeclaration.prototype.addChildScopeByElement = function (element, executor) {
        var childScope = new scope_1.Scope(element, executor);
        this.addChildScope(childScope);
    };
    ScopeTrackingDeclaration.prototype.removeChildScopeByElement = function (element) {
        for (var _i = 0, _a = this.childScopes; _i < _a.length; _i++) {
            var childScope = _a[_i];
            if (childScope.getElement() === element) {
                this.removeChildScope(childScope);
                return; // loop must exist to avoid data-race
            }
        }
    };
    return ScopeTrackingDeclaration;
}(declaration_1.Declaration));
exports.ScopeTrackingDeclaration = ScopeTrackingDeclaration;

},{"../scope":11,"./declaration":3}],7:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var scope_tracking_declaration_1 = require("./scope_tracking_declaration");
var matching_elements_subscription_1 = require("../subscriptions/matching_elements_subscription");
var SelectDeclaration = (function (_super) {
    __extends(SelectDeclaration, _super);
    function SelectDeclaration(element, matcher, executor) {
        var _this = _super.call(this, element) || this;
        _this.matcher = matcher;
        _this.executor = executor;
        _this.subscription = new matching_elements_subscription_1.MatchingElementsSubscription(_this.element, _this.matcher, function (event) {
            for (var _i = 0, _a = event.addedElements; _i < _a.length; _i++) {
                var element_1 = _a[_i];
                _this.addChildScopeByElement(element_1, _this.executor);
            }
            for (var _b = 0, _c = event.removedElements; _b < _c.length; _b++) {
                var element_2 = _c[_b];
                _this.removeChildScopeByElement(element_2);
            }
        });
        return _this;
    }
    SelectDeclaration.prototype.inspect = function () {
        console.group(this.matcher, '(' + this.childScopes.length + ' matches)');
        try {
            for (var _i = 0, _a = this.childScopes; _i < _a.length; _i++) {
                var childScope = _a[_i];
                childScope.inspect();
            }
        }
        finally {
            console.groupEnd();
        }
    };
    return SelectDeclaration;
}(scope_tracking_declaration_1.ScopeTrackingDeclaration));
exports.SelectDeclaration = SelectDeclaration;

},{"../subscriptions/matching_elements_subscription":15,"./scope_tracking_declaration":6}],8:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var declaration_1 = require("./declaration");
var trivial_subscription_1 = require("../subscriptions/trivial_subscription");
var UnmatchDeclaration = (function (_super) {
    __extends(UnmatchDeclaration, _super);
    function UnmatchDeclaration(element, executor) {
        var _this = _super.call(this, element) || this;
        _this.executor = executor;
        _this.subscription = new trivial_subscription_1.TrivialSubscription(_this.element, { disconnected: true }, _this.executor);
        return _this;
    }
    UnmatchDeclaration.prototype.inspect = function () {
        console.log('fires', this.executor, 'when the element leaves the DOM (unmatches)');
    };
    return UnmatchDeclaration;
}(declaration_1.Declaration));
exports.UnmatchDeclaration = UnmatchDeclaration;

},{"../subscriptions/trivial_subscription":17,"./declaration":3}],9:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var scope_tracking_declaration_1 = require("./scope_tracking_declaration");
var element_matches_subscription_1 = require("../subscriptions/element_matches_subscription");
var WhenDeclaration = (function (_super) {
    __extends(WhenDeclaration, _super);
    function WhenDeclaration(element, matcher, executor) {
        var _this = _super.call(this, element) || this;
        _this.matcher = matcher;
        _this.executor = executor;
        _this.subscription = new element_matches_subscription_1.ElementMatchesSubscription(_this.element, _this.matcher, function (event) {
            if (event.isMatching) {
                _this.addChildScopeByElement(element, _this.executor);
            }
            else {
                _this.removeChildScopeByElement(element);
            }
        });
        return _this;
    }
    WhenDeclaration.prototype.inspect = function () {
        console.group('&', this.matcher, '(' + this.childScopes.length + ' matches)');
        try {
            for (var _i = 0, _a = this.childScopes; _i < _a.length; _i++) {
                var childScope = _a[_i];
                childScope.inspect();
            }
        }
        finally {
            console.groupEnd();
        }
    };
    return WhenDeclaration;
}(scope_tracking_declaration_1.ScopeTrackingDeclaration));
exports.WhenDeclaration = WhenDeclaration;

},{"../subscriptions/element_matches_subscription":13,"./scope_tracking_declaration":6}],10:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ElementCollector;
var ElementCollector = (function () {
    function ElementCollector() {
    }
    ElementCollector.isMatchingElement = function (rootElement, elementMatcher) {
        return this.getInstance().isMatchingElement(rootElement, elementMatcher);
    };
    ElementCollector.collectMatchingElements = function (rootElement, elementMatcher) {
        return this.getInstance().collectMatchingElements(rootElement, elementMatcher);
    };
    ElementCollector.getInstance = function () {
        return this.instance || (this.instance = new ElementCollector());
    };
    ElementCollector.prototype.isMatchingElement = function (element, elementMatcher) {
        switch (typeof (elementMatcher)) {
            default:
                throw new TypeError(ElementCollector.ELEMENT_MATCHER_TYPE_ERROR_MESSAGE);
            case 'string':
                var cssSelector = elementMatcher;
                return this.isMatchingElementFromCssSelector(element, cssSelector);
            case 'object':
                var object = elementMatcher;
                return this.isMatchingElementFromObject(element, object);
            case 'function':
                var elementVistor = elementMatcher;
                return this.isMatchingElementFromElementVistor(element, elementVistor);
        }
    };
    ElementCollector.prototype.collectMatchingElements = function (element, elementMatcher) {
        switch (typeof (elementMatcher)) {
            default:
                throw new TypeError(ElementCollector.ELEMENT_MATCHER_TYPE_ERROR_MESSAGE);
            case 'string':
                var cssSelector = elementMatcher;
                return this.collectMatchingElementsFromCssSelector(element, cssSelector);
            case 'object':
                var object = elementMatcher;
                return this.collectMatchingElementsFromObject(element, object);
            case 'function':
                var elementVistor = elementMatcher;
                return this.collectMatchingElementsFromElementVistor(element, elementVistor);
        }
    };
    ElementCollector.prototype.isMatchingElementFromCssSelector = function (element, cssSelector) {
        if (typeof (element.matches) === 'function') {
            return element.matches(cssSelector);
        }
        else {
            return isMemberOfArrayLike(document.querySelectorAll(cssSelector), element);
        }
    };
    ElementCollector.prototype.isMatchingElementFromObject = function (element, object) {
        if (object === null) {
            return false;
        }
        else {
            if (isArrayLike(object)) {
                var arrayLike = object;
                if (arrayLike.length === 0 || arrayLike[0] instanceof Element) {
                    return isMemberOfArrayLike(arrayLike, element);
                }
                else {
                    throw new TypeError(ElementCollector.ELEMENT_MATCHER_TYPE_ERROR_MESSAGE);
                }
            }
            else {
                throw new TypeError(ElementCollector.ELEMENT_MATCHER_TYPE_ERROR_MESSAGE);
            }
        }
    };
    ElementCollector.prototype.isMatchingElementFromElementVistor = function (element, elementVistor) {
        var visitorResult = elementVistor(element);
        if (typeof (visitorResult) === 'boolean') {
            var isMatch = visitorResult;
            return isMatch;
        }
        else {
            var elementMatcher = visitorResult;
            return this.isMatchingElement(element, elementMatcher);
        }
    };
    ElementCollector.prototype.collectMatchingElementsFromCssSelector = function (element, cssSelector) {
        return toArray(element.querySelectorAll(cssSelector));
    };
    ElementCollector.prototype.collectMatchingElementsFromObject = function (_element, object) {
        if (object === null) {
            return [];
        }
        else {
            if (isArrayLike(object)) {
                var arrayLike = object;
                if (arrayLike.length === 0 || arrayLike[0] instanceof Element) {
                    return toArray(arrayLike);
                }
                else {
                    throw new TypeError(ElementCollector.ELEMENT_MATCHER_TYPE_ERROR_MESSAGE);
                }
            }
            else {
                throw new TypeError(ElementCollector.ELEMENT_MATCHER_TYPE_ERROR_MESSAGE);
            }
        }
    };
    ElementCollector.prototype.collectMatchingElementsFromElementVistor = function (element, elementVistor) {
        var elements = [];
        var children = element.children;
        for (var index = 0, length_1 = children.length; index < length_1; index++) {
            var child = children[index];
            if (child instanceof Element) {
                var element_1 = child;
                var visitorResult = elementVistor(element_1);
                if (typeof (visitorResult) === 'boolean') {
                    var isMatch = visitorResult;
                    if (isMatch) {
                        elements.push(element_1);
                    }
                }
                else {
                    elements.push.apply(elements, this.collectMatchingElements(element_1, visitorResult));
                }
            }
        }
        return elements;
    };
    return ElementCollector;
}());
ElementCollector.ELEMENT_MATCHER_TYPE_ERROR_MESSAGE = "Decl: An `ElementMatcher` must be a CSS selector (string) or a function which takes a node under consideration and returns a CSS selector (string) that matches all matching nodes in the subtree, an array-like object of matching nodes in the subtree, or a boolean value as to whether the node should be included (in this case, the function will be invoked again for all children of the node).";
exports.ElementCollector = ElementCollector;
function isArrayLike(value) {
    return typeof (value) === 'object' && typeof (value.length) === 'number';
}
function toArray(arrayLike) {
    if (isArrayLike(arrayLike)) {
        return Array.prototype.slice.call(arrayLike, 0);
    }
    else {
        throw new TypeError('Expected ArrayLike');
    }
}
function isMemberOfArrayLike(haystack, needle) {
    return Array.prototype.indexOf.call(haystack, needle) !== -1;
}

},{}],11:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var declaration_1 = require("./declarations/declaration");
exports.Declaration = declaration_1.Declaration;
var match_declaration_1 = require("./declarations/match_declaration");
var unmatch_declaration_1 = require("./declarations/unmatch_declaration");
var on_declaration_1 = require("./declarations/on_declaration");
var select_declaration_1 = require("./declarations/select_declaration");
var when_declaration_1 = require("./declarations/when_declaration");
;
var Scope = (function () {
    function Scope(element, executor) {
        this.isActivated = false;
        this.declarations = [];
        this.element = element;
        if (executor) {
            executor.call(this, this, this.element);
        }
    }
    Scope.buildRootScope = function (element) {
        var scope = new Scope(element);
        scope.activate();
        return scope;
    };
    Scope.prototype.getElement = function () {
        return this.element;
    };
    Scope.prototype.getDeclarations = function () {
        return this.declarations;
    };
    Scope.prototype.inspect = function () {
        if (this.isActivated) {
            console.group(this.element, '(active)');
        }
        else {
            console.group(this.element, '(inactive)');
        }
        try {
            for (var _i = 0, _a = this.declarations; _i < _a.length; _i++) {
                var declaration = _a[_i];
                declaration.inspect();
            }
        }
        finally {
            console.groupEnd();
        }
    };
    Scope.prototype.activate = function () {
        if (!this.isActivated) {
            this.isActivated = true;
            for (var _i = 0, _a = this.declarations; _i < _a.length; _i++) {
                var declaration = _a[_i];
                declaration.activate();
            }
        }
    };
    Scope.prototype.deactivate = function () {
        if (this.isActivated) {
            this.isActivated = false;
            for (var _i = 0, _a = this.declarations; _i < _a.length; _i++) {
                var declaration = _a[_i];
                declaration.deactivate();
            }
        }
    };
    Scope.prototype.pristine = function () {
        this.deactivate();
        this.removeAllDeclarations();
    };
    Scope.prototype.match = function (executor) {
        this.addDeclaration(new match_declaration_1.MatchDeclaration(this.element, executor));
        return this;
    };
    Scope.prototype.unmatch = function (executor) {
        this.addDeclaration(new unmatch_declaration_1.UnmatchDeclaration(this.element, executor));
        return this;
    };
    Scope.prototype.select = function (matcher, executor) {
        this.addDeclaration(new select_declaration_1.SelectDeclaration(this.element, matcher, executor));
        return this;
    };
    Scope.prototype.when = function (matcher, executor) {
        this.addDeclaration(new when_declaration_1.WhenDeclaration(this.element, matcher, executor));
        return this;
    };
    Scope.prototype.on = function (eventMatcher, executorOrElementMatcher, maybeExecutor) {
        var argumentsCount = arguments.length;
        switch (argumentsCount) {
            case 2:
                return this.onWithTwoArguments(eventMatcher, executorOrElementMatcher);
            case 3:
                return this.onWithThreeArguments(eventMatcher, executorOrElementMatcher, maybeExecutor);
            default:
                throw new TypeError("Failed to execute 'on' on 'Scope': 2 or 3 arguments required, but " + argumentsCount + " present.");
        }
    };
    Scope.prototype.onWithTwoArguments = function (eventMatcher, executor) {
        this.addDeclaration(new on_declaration_1.OnDeclaration(this.element, eventMatcher, executor));
        return this;
    };
    Scope.prototype.onWithThreeArguments = function (eventMatcher, elementMatcher, executor) {
        this.select(elementMatcher, function (scope) {
            scope.on(eventMatcher, executor);
        });
        return this;
    };
    Scope.prototype.addDeclaration = function (declaration) {
        this.declarations.push(declaration);
        if (this.isActivated) {
            declaration.activate();
        }
    };
    Scope.prototype.removeDeclaration = function (declaration) {
        var index = this.declarations.indexOf(declaration);
        if (index >= 0) {
            this.declarations.splice(index, 1);
        }
        declaration.deactivate();
    };
    Scope.prototype.removeAllDeclarations = function () {
        var declaration;
        while (declaration = this.declarations[0]) {
            this.removeDeclaration(declaration);
        }
    };
    return Scope;
}());
exports.Scope = Scope;

},{"./declarations/declaration":3,"./declarations/match_declaration":4,"./declarations/on_declaration":5,"./declarations/select_declaration":7,"./declarations/unmatch_declaration":8,"./declarations/when_declaration":9}],12:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var subscription_1 = require("./subscription");
exports.Subscription = subscription_1.Subscription;
exports.SubscriptionEvent = subscription_1.SubscriptionEvent;
var MutationObserver = require('mutation-observer'); // use polyfill
var BatchedMutationSubscription = (function (_super) {
    __extends(BatchedMutationSubscription, _super);
    function BatchedMutationSubscription(element, executor) {
        var _this = _super.call(this, element, executor) || this;
        _this.isListening = false;
        _this.handleMutationTimeout = null;
        _this.mutationCallback = function () {
            _this.deferHandleMutations();
        };
        _this.mutationObserver = new MutationObserver(_this.mutationCallback);
        return _this;
    }
    BatchedMutationSubscription.prototype.startListening = function () {
        if (!this.isListening) {
            this.mutationObserver.observe(this.element, BatchedMutationSubscription.mutationObserverInit);
            this.isListening = true;
        }
    };
    BatchedMutationSubscription.prototype.stopListening = function () {
        if (this.isListening) {
            this.mutationObserver.disconnect();
            this.handleMutationsNow();
            this.isListening = false;
        }
    };
    BatchedMutationSubscription.prototype.deferHandleMutations = function () {
        var _this = this;
        if (this.handleMutationTimeout === null) {
            this.handleMutationTimeout = setTimeout(function () {
                try {
                    _this.mutationObserver.takeRecords();
                    _this.handleMutations();
                }
                finally {
                    _this.handleMutationTimeout = null;
                }
            }, 0);
        }
    };
    BatchedMutationSubscription.prototype.handleMutationsNow = function () {
        if (this.handleMutationTimeout !== null) {
            clearTimeout(this.handleMutationTimeout);
            this.handleMutationTimeout = null;
            this.handleMutations();
        }
    };
    return BatchedMutationSubscription;
}(subscription_1.Subscription));
BatchedMutationSubscription.mutationObserverInit = {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true
};
exports.BatchedMutationSubscription = BatchedMutationSubscription;

},{"./subscription":16,"mutation-observer":1}],13:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var batched_mutation_subscription_1 = require("./batched_mutation_subscription");
var element_collector_1 = require("../element_collector");
var ElementMatchesSubscription = (function (_super) {
    __extends(ElementMatchesSubscription, _super);
    function ElementMatchesSubscription(element, matcher, executor) {
        var _this = _super.call(this, element, executor) || this;
        _this.isConnected = false;
        _this.isMatchingElement = false;
        _this.matcher = matcher;
        return _this;
    }
    ElementMatchesSubscription.prototype.connect = function () {
        if (!this.isConnected) {
            this.updateIsMatchingElement(this.computeIsMatchingElement());
            this.startListening();
            this.isConnected = true;
        }
    };
    ElementMatchesSubscription.prototype.disconnect = function () {
        if (this.isConnected) {
            this.stopListening();
            this.updateIsMatchingElement(false);
            this.isConnected = false;
        }
    };
    ElementMatchesSubscription.prototype.handleMutations = function () {
        this.updateIsMatchingElement(this.computeIsMatchingElement());
    };
    ElementMatchesSubscription.prototype.updateIsMatchingElement = function (isMatchingElement) {
        var wasMatchingElement = this.isMatchingElement;
        this.isMatchingElement = isMatchingElement;
        if (wasMatchingElement !== isMatchingElement) {
            var event_1 = new ElementMatchesChangedEvent(this, isMatchingElement);
            this.executor(event_1, this.element);
        }
    };
    ElementMatchesSubscription.prototype.computeIsMatchingElement = function () {
        return element_collector_1.ElementCollector.isMatchingElement(this.element, this.matcher);
    };
    return ElementMatchesSubscription;
}(batched_mutation_subscription_1.BatchedMutationSubscription));
exports.ElementMatchesSubscription = ElementMatchesSubscription;
var ElementMatchesChangedEvent = (function (_super) {
    __extends(ElementMatchesChangedEvent, _super);
    function ElementMatchesChangedEvent(elementMatchesSubscription, isMatching) {
        var _this = _super.call(this, elementMatchesSubscription, 'ElementMatchesChangedEvent') || this;
        _this.isMatching = isMatching;
        return _this;
    }
    return ElementMatchesChangedEvent;
}(batched_mutation_subscription_1.SubscriptionEvent));
exports.ElementMatchesChangedEvent = ElementMatchesChangedEvent;

},{"../element_collector":10,"./batched_mutation_subscription":12}],14:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var subscription_1 = require("./subscription");
var EventSubscription = (function (_super) {
    __extends(EventSubscription, _super);
    function EventSubscription(element, eventMatcher, executor) {
        var _this = _super.call(this, element, executor) || this;
        _this.isConnected = false;
        _this.eventMatcher = eventMatcher;
        _this.eventNames = _this.parseEventMatcher(_this.eventMatcher);
        _this.eventListener = function (event) {
            _this.handleEvent(event);
        };
        return _this;
    }
    EventSubscription.prototype.connect = function () {
        if (!this.isConnected) {
            this.isConnected = true;
            for (var _i = 0, _a = this.eventNames; _i < _a.length; _i++) {
                var eventName = _a[_i];
                this.element.addEventListener(eventName, this.eventListener, false);
            }
        }
    };
    EventSubscription.prototype.disconnect = function () {
        if (this.isConnected) {
            for (var _i = 0, _a = this.eventNames; _i < _a.length; _i++) {
                var eventName = _a[_i];
                this.element.removeEventListener(eventName, this.eventListener, false);
            }
            this.isConnected = false;
        }
    };
    EventSubscription.prototype.handleEvent = function (event) {
        this.executor(event, this.element);
    };
    EventSubscription.prototype.parseEventMatcher = function (eventMatcher) {
        // TODO: Support all of the jQuery style event options
        return eventMatcher.split(' ');
    };
    return EventSubscription;
}(subscription_1.Subscription));
exports.EventSubscription = EventSubscription;

},{"./subscription":16}],15:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var batched_mutation_subscription_1 = require("./batched_mutation_subscription");
var element_collector_1 = require("../element_collector");
var MatchingElementsSubscription = (function (_super) {
    __extends(MatchingElementsSubscription, _super);
    function MatchingElementsSubscription(element, matcher, executor) {
        var _this = _super.call(this, element, executor) || this;
        _this.isConnected = false;
        _this.matchingElements = [];
        _this.matcher = matcher;
        return _this;
    }
    MatchingElementsSubscription.prototype.connect = function () {
        if (!this.isConnected) {
            this.updateMatchingElements(this.collectMatchingElements());
            this.startListening();
            this.isConnected = true;
        }
    };
    MatchingElementsSubscription.prototype.disconnect = function () {
        if (this.isConnected) {
            this.stopListening();
            this.updateMatchingElements([]);
            this.isConnected = false;
        }
    };
    MatchingElementsSubscription.prototype.handleMutations = function () {
        this.updateMatchingElements(this.collectMatchingElements());
    };
    MatchingElementsSubscription.prototype.updateMatchingElements = function (matchingElements) {
        var previouslyMatchingElements = this.matchingElements;
        var addedElements = arraySubtract(matchingElements, previouslyMatchingElements);
        var removedElements = arraySubtract(previouslyMatchingElements, matchingElements);
        this.matchingElements = matchingElements;
        if (addedElements.length > 0 || removedElements.length > 0) {
            var event_1 = new MatchingElementsChangedEvent(this, addedElements, removedElements);
            this.executor(event_1, this.element);
        }
    };
    MatchingElementsSubscription.prototype.collectMatchingElements = function () {
        return element_collector_1.ElementCollector.collectMatchingElements(this.element, this.matcher);
    };
    return MatchingElementsSubscription;
}(batched_mutation_subscription_1.BatchedMutationSubscription));
exports.MatchingElementsSubscription = MatchingElementsSubscription;
var MatchingElementsChangedEvent = (function (_super) {
    __extends(MatchingElementsChangedEvent, _super);
    function MatchingElementsChangedEvent(matchingElementsSubscription, addedElements, removedElements) {
        var _this = _super.call(this, matchingElementsSubscription, 'MatchingElementsChanged') || this;
        _this.addedElements = addedElements;
        _this.removedElements = removedElements;
        return _this;
    }
    return MatchingElementsChangedEvent;
}(batched_mutation_subscription_1.SubscriptionEvent));
exports.MatchingElementsChangedEvent = MatchingElementsChangedEvent;
function arraySubtract(minuend, subtrahend) {
    var difference = [];
    for (var _i = 0, minuend_1 = minuend; _i < minuend_1.length; _i++) {
        var member = minuend_1[_i];
        if (subtrahend.indexOf(member) === -1) {
            difference.push(member);
        }
    }
    return difference;
}

},{"../element_collector":10,"./batched_mutation_subscription":12}],16:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Subscription = (function () {
    function Subscription(element, executor) {
        this.element = element;
        this.executor = executor;
    }
    return Subscription;
}());
exports.Subscription = Subscription;
var SubscriptionEvent = (function () {
    function SubscriptionEvent(subscription, name) {
        this.subscription = subscription;
        this.name = name;
    }
    return SubscriptionEvent;
}());
exports.SubscriptionEvent = SubscriptionEvent;

},{}],17:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var subscription_1 = require("./subscription");
var ElementConnectionChangedEvent = (function (_super) {
    __extends(ElementConnectionChangedEvent, _super);
    function ElementConnectionChangedEvent(trivialSubscription, element, isConnected) {
        var _this = _super.call(this, trivialSubscription, 'ElementConnected') || this;
        _this.element = element;
        _this.isConnected = isConnected;
        return _this;
    }
    return ElementConnectionChangedEvent;
}(subscription_1.SubscriptionEvent));
exports.ElementConnectionChangedEvent = ElementConnectionChangedEvent;
var TrivialSubscription = (function (_super) {
    __extends(TrivialSubscription, _super);
    function TrivialSubscription(element, config, executor) {
        var _this = _super.call(this, element, executor) || this;
        _this.isConnected = false;
        _this.config = config;
        return _this;
    }
    TrivialSubscription.prototype.connect = function () {
        if (!this.isConnected) {
            this.isConnected = true;
            if (this.config.connected) {
                this.executor(this.buildElementConnectionChangedEvent(), this.element);
            }
        }
    };
    TrivialSubscription.prototype.disconnect = function () {
        if (this.isConnected) {
            this.isConnected = false;
            if (this.config.disconnected) {
                this.executor(this.buildElementConnectionChangedEvent(), this.element);
            }
        }
    };
    TrivialSubscription.prototype.buildElementConnectionChangedEvent = function () {
        return new ElementConnectionChangedEvent(this, this.element, this.isConnected);
    };
    return TrivialSubscription;
}(subscription_1.Subscription));
exports.TrivialSubscription = TrivialSubscription;

},{"./subscription":16}]},{},[2])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvbXV0YXRpb24tb2JzZXJ2ZXIvaW5kZXguanMiLCJzcmMvZGVjbC50cyIsInNyYy9kZWNsYXJhdGlvbnMvZGVjbGFyYXRpb24udHMiLCJzcmMvZGVjbGFyYXRpb25zL21hdGNoX2RlY2xhcmF0aW9uLnRzIiwic3JjL2RlY2xhcmF0aW9ucy9vbl9kZWNsYXJhdGlvbi50cyIsInNyYy9kZWNsYXJhdGlvbnMvc2NvcGVfdHJhY2tpbmdfZGVjbGFyYXRpb24udHMiLCJzcmMvZGVjbGFyYXRpb25zL3NlbGVjdF9kZWNsYXJhdGlvbi50cyIsInNyYy9kZWNsYXJhdGlvbnMvdW5tYXRjaF9kZWNsYXJhdGlvbi50cyIsInNyYy9kZWNsYXJhdGlvbnMvd2hlbl9kZWNsYXJhdGlvbi50cyIsInNyYy9lbGVtZW50X2NvbGxlY3Rvci50cyIsInNyYy9zY29wZS50cyIsInNyYy9zdWJzY3JpcHRpb25zL2JhdGNoZWRfbXV0YXRpb25fc3Vic2NyaXB0aW9uLnRzIiwic3JjL3N1YnNjcmlwdGlvbnMvZWxlbWVudF9tYXRjaGVzX3N1YnNjcmlwdGlvbi50cyIsInNyYy9zdWJzY3JpcHRpb25zL2V2ZW50X3N1YnNjcmlwdGlvbi50cyIsInNyYy9zdWJzY3JpcHRpb25zL21hdGNoaW5nX2VsZW1lbnRzX3N1YnNjcmlwdGlvbi50cyIsInNyYy9zdWJzY3JpcHRpb25zL3N1YnNjcmlwdGlvbi50cyIsInNyYy9zdWJzY3JpcHRpb25zL3RyaXZpYWxfc3Vic2NyaXB0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUN6a0JBLGlDQUFtRztBQUkxRiw4QkFBSztBQUZkLGtCQUFlLElBQUksQ0FBQztBQUlwQjtJQW9DSSxjQUFZLElBQWE7UUFDckIsSUFBSSxDQUFDLEtBQUssR0FBRyxhQUFLLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzVDLENBQUM7SUFuQ00sV0FBTSxHQUFiLFVBQWMsT0FBdUIsRUFBRSxRQUF1QjtRQUMxRCxNQUFNLENBQUMsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQztJQUMvRCxDQUFDO0lBRU0sT0FBRSxHQUFULFVBQVUsT0FBcUIsRUFBRSxRQUE4QjtRQUMzRCxNQUFNLENBQUMsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQztJQUMzRCxDQUFDO0lBRU0saUJBQVksR0FBbkI7UUFDSSxNQUFNLENBQUMsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUMsWUFBWSxFQUFFLENBQUM7SUFDcEQsQ0FBQztJQUVNLFlBQU8sR0FBZDtRQUNJLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQ3hDLENBQUM7SUFFTSx1QkFBa0IsR0FBekI7UUFDSSxNQUFNLENBQUMsSUFBSSxDQUFDLGVBQWUsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUM7SUFDL0YsQ0FBQztJQUVNLHVCQUFrQixHQUF6QixVQUEwQixJQUFVO1FBQ2hDLE1BQU0sQ0FBQyxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQztJQUN2QyxDQUFDO0lBRU0sYUFBUSxHQUFmO1FBQ0ksRUFBRSxDQUFBLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUM7WUFDdEIsSUFBSSxDQUFDLGVBQWUsQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNoQyxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQztRQUNoQyxDQUFDO0lBQ0wsQ0FBQztJQVFELHFCQUFNLEdBQU4sVUFBTyxPQUF1QixFQUFFLFFBQXVCO1FBQ25ELE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDaEQsQ0FBQztJQUVELGlCQUFFLEdBQUYsVUFBRyxPQUFxQixFQUFFLFFBQThCO1FBQ3BELE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDNUMsQ0FBQztJQUVELDJCQUFZLEdBQVo7UUFDRyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQztJQUNyQixDQUFDO0lBRUQsc0JBQU8sR0FBUDtRQUNJLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDekIsQ0FBQztJQUVELHVCQUFRLEdBQVI7UUFDSSxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsRUFBRSxDQUFDO0lBQzFCLENBQUM7SUFDTCxXQUFDO0FBQUQsQ0EzREEsQUEyREM7QUExRGtCLG9CQUFlLEdBQWdCLElBQUksQ0FBQztBQUQxQyxvQkFBSTtBQTZEakIsa0ZBQWtGO0FBQ2xGLEVBQUUsQ0FBQSxDQUFDLE9BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxXQUFXLENBQUMsQ0FBQyxDQUFDO0lBQzFCLE1BQU8sQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDO0FBQzlCLENBQUM7Ozs7O0FDbEVEO0lBS0kscUJBQVksT0FBZ0I7UUFKbEIsZ0JBQVcsR0FBWSxLQUFLLENBQUM7UUFLbkMsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7SUFDM0IsQ0FBQztJQUVELDhCQUFRLEdBQVI7UUFDSSxFQUFFLENBQUEsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1lBQ25CLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDO1lBRXhCLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDaEMsQ0FBQztJQUNMLENBQUM7SUFFRCxnQ0FBVSxHQUFWO1FBQ0ksRUFBRSxDQUFBLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7WUFDbEIsSUFBSSxDQUFDLFdBQVcsR0FBRyxLQUFLLENBQUM7WUFFekIsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsQ0FBQztRQUNuQyxDQUFDO0lBQ0wsQ0FBQztJQUdMLGtCQUFDO0FBQUQsQ0ExQkEsQUEwQkMsSUFBQTtBQTFCcUIsa0NBQVc7Ozs7Ozs7Ozs7Ozs7OztBQ0pqQyw2Q0FBa0U7QUFDbEUsOEVBQTRFO0FBSTVFO0lBQXNDLG9DQUFXO0lBSTdDLDBCQUFZLE9BQWdCLEVBQUUsUUFBOEI7UUFBNUQsWUFDSSxrQkFBTSxPQUFPLENBQUMsU0FLakI7UUFIRyxLQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztRQUV6QixLQUFJLENBQUMsWUFBWSxHQUFHLElBQUksMENBQW1CLENBQUMsS0FBSSxDQUFDLE9BQU8sRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsRUFBRSxLQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7O0lBQ2xHLENBQUM7SUFFRCxrQ0FBTyxHQUFQO1FBQ0ksT0FBTyxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBRSwyQ0FBMkMsQ0FBQyxDQUFDO0lBQ3JGLENBQUM7SUFDTCx1QkFBQztBQUFELENBZkEsQUFlQyxDQWZxQyx5QkFBVyxHQWVoRDtBQWZZLDRDQUFnQjs7Ozs7Ozs7Ozs7Ozs7O0FDTDdCLDZDQUFrRTtBQUNsRSwwRUFBc0Y7QUFJdEY7SUFBbUMsaUNBQVc7SUFLMUMsdUJBQVksT0FBZ0IsRUFBRSxPQUFxQixFQUFFLFFBQThCO1FBQW5GLFlBQ0ksa0JBQU0sT0FBTyxDQUFDLFNBTWpCO1FBSkcsS0FBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsS0FBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFFekIsS0FBSSxDQUFDLFlBQVksR0FBRyxJQUFJLHNDQUFpQixDQUFDLEtBQUksQ0FBQyxPQUFPLEVBQUUsS0FBSSxDQUFDLE9BQU8sRUFBRSxLQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7O0lBQ3pGLENBQUM7SUFFRCwrQkFBTyxHQUFQO1FBQ0ksT0FBTyxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQzVELENBQUM7SUFDTCxvQkFBQztBQUFELENBakJBLEFBaUJDLENBakJrQyx5QkFBVyxHQWlCN0M7QUFqQlksc0NBQWE7Ozs7Ozs7Ozs7Ozs7OztBQ0wxQiw2Q0FBNEM7QUFFNUMsa0NBQWdEO0FBSWhEO0lBQXVELDRDQUFXO0lBQWxFO1FBQUEscUVBc0RDO1FBckRzQixpQkFBVyxHQUFZLEVBQUUsQ0FBQzs7SUFxRGpELENBQUM7SUFuREcsNkNBQVUsR0FBVjtRQUNJLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBQzVCLGlCQUFNLFVBQVUsV0FBRSxDQUFDO0lBQ3ZCLENBQUM7SUFFRCxpREFBYyxHQUFkO1FBQ0ksTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUM7SUFDNUIsQ0FBQztJQUVTLGdEQUFhLEdBQXZCLFVBQXdCLEtBQVk7UUFDaEMsRUFBRSxDQUFBLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7WUFDbEIsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7WUFFN0IsS0FBSyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ3JCLENBQUM7SUFDTCxDQUFDO0lBRVMsbURBQWdCLEdBQTFCLFVBQTJCLEtBQVk7UUFDbkMsS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBRW5CLEVBQUUsQ0FBQSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1lBQ2xCLElBQUksS0FBSyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRTVDLEVBQUUsQ0FBQSxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNaLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQztZQUN0QyxDQUFDO1FBQ0wsQ0FBQztJQUNMLENBQUM7SUFFUyx1REFBb0IsR0FBOUI7UUFDSSxJQUFJLFVBQWlCLENBQUM7UUFFdEIsT0FBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQ3JDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUN0QyxDQUFDO0lBQ0wsQ0FBQztJQUVTLHlEQUFzQixHQUFoQyxVQUFpQyxPQUFnQixFQUFFLFFBQXdCO1FBQ3ZFLElBQUksVUFBVSxHQUFHLElBQUksYUFBSyxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQztRQUU5QyxJQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQ25DLENBQUM7SUFFUyw0REFBeUIsR0FBbkMsVUFBb0MsT0FBZ0I7UUFDaEQsR0FBRyxDQUFBLENBQW1CLFVBQWdCLEVBQWhCLEtBQUEsSUFBSSxDQUFDLFdBQVcsRUFBaEIsY0FBZ0IsRUFBaEIsSUFBZ0I7WUFBbEMsSUFBSSxVQUFVLFNBQUE7WUFDZCxFQUFFLENBQUEsQ0FBQyxVQUFVLENBQUMsVUFBVSxFQUFFLEtBQUssT0FBTyxDQUFDLENBQUMsQ0FBQztnQkFDckMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFVBQVUsQ0FBQyxDQUFDO2dCQUNsQyxNQUFNLENBQUMsQ0FBQyxxQ0FBcUM7WUFDakQsQ0FBQztTQUNKO0lBQ0wsQ0FBQztJQUNMLCtCQUFDO0FBQUQsQ0F0REEsQUFzREMsQ0F0RHNELHlCQUFXLEdBc0RqRTtBQXREcUIsNERBQXdCOzs7Ozs7Ozs7Ozs7Ozs7QUNOOUMsMkVBQXVHO0FBQ3ZHLGtHQUE2SDtBQUk3SDtJQUF1QyxxQ0FBd0I7SUFLM0QsMkJBQVksT0FBZ0IsRUFBRSxPQUF1QixFQUFFLFFBQXVCO1FBQTlFLFlBQ0ksa0JBQU0sT0FBTyxDQUFDLFNBY2pCO1FBWkcsS0FBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsS0FBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFFekIsS0FBSSxDQUFDLFlBQVksR0FBRyxJQUFJLDZEQUE0QixDQUFDLEtBQUksQ0FBQyxPQUFPLEVBQUUsS0FBSSxDQUFDLE9BQU8sRUFBRSxVQUFDLEtBQW1DO1lBQ2pILEdBQUcsQ0FBQSxDQUFnQixVQUFtQixFQUFuQixLQUFBLEtBQUssQ0FBQyxhQUFhLEVBQW5CLGNBQW1CLEVBQW5CLElBQW1CO2dCQUFsQyxJQUFJLFNBQU8sU0FBQTtnQkFDWCxLQUFJLENBQUMsc0JBQXNCLENBQUMsU0FBTyxFQUFFLEtBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQzthQUN2RDtZQUVELEdBQUcsQ0FBQSxDQUFnQixVQUFxQixFQUFyQixLQUFBLEtBQUssQ0FBQyxlQUFlLEVBQXJCLGNBQXFCLEVBQXJCLElBQXFCO2dCQUFwQyxJQUFJLFNBQU8sU0FBQTtnQkFDWCxLQUFJLENBQUMseUJBQXlCLENBQUMsU0FBTyxDQUFDLENBQUM7YUFDM0M7UUFDTCxDQUFDLENBQUMsQ0FBQzs7SUFDUCxDQUFDO0lBRUQsbUNBQU8sR0FBUDtRQUNVLE9BQU8sQ0FBQyxLQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxHQUFHLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLEdBQUcsV0FBVyxDQUFDLENBQUM7UUFFaEYsSUFBSSxDQUFDO1lBQ0QsR0FBRyxDQUFBLENBQW1CLFVBQWdCLEVBQWhCLEtBQUEsSUFBSSxDQUFDLFdBQVcsRUFBaEIsY0FBZ0IsRUFBaEIsSUFBZ0I7Z0JBQWxDLElBQUksVUFBVSxTQUFBO2dCQUNkLFVBQVUsQ0FBQyxPQUFPLEVBQUUsQ0FBQzthQUN4QjtRQUNMLENBQUM7Z0JBQU8sQ0FBQztZQUNMLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUN2QixDQUFDO0lBQ0wsQ0FBQztJQUNMLHdCQUFDO0FBQUQsQ0FqQ0EsQUFpQ0MsQ0FqQ3NDLHFEQUF3QixHQWlDOUQ7QUFqQ1ksOENBQWlCOzs7Ozs7Ozs7Ozs7Ozs7QUNMOUIsNkNBQTRDO0FBQzVDLDhFQUFrRztBQUlsRztJQUF3QyxzQ0FBVztJQUkvQyw0QkFBWSxPQUFnQixFQUFFLFFBQThCO1FBQTVELFlBQ0ksa0JBQU0sT0FBTyxDQUFDLFNBS2pCO1FBSEcsS0FBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFFekIsS0FBSSxDQUFDLFlBQVksR0FBRyxJQUFJLDBDQUFtQixDQUFDLEtBQUksQ0FBQyxPQUFPLEVBQUUsRUFBRSxZQUFZLEVBQUUsSUFBSSxFQUFFLEVBQUUsS0FBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDOztJQUNyRyxDQUFDO0lBRUQsb0NBQU8sR0FBUDtRQUNJLE9BQU8sQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxRQUFRLEVBQUUsNkNBQTZDLENBQUMsQ0FBQztJQUN2RixDQUFDO0lBQ0wseUJBQUM7QUFBRCxDQWZBLEFBZUMsQ0FmdUMseUJBQVcsR0FlbEQ7QUFmWSxnREFBa0I7Ozs7Ozs7Ozs7Ozs7OztBQ0wvQiwyRUFBdUc7QUFDdkcsOEZBQXVIO0FBSXZIO0lBQXFDLG1DQUF3QjtJQUt6RCx5QkFBWSxPQUFnQixFQUFFLE9BQXVCLEVBQUUsUUFBdUI7UUFBOUUsWUFDSSxrQkFBTSxPQUFPLENBQUMsU0FZakI7UUFWRyxLQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQztRQUN2QixLQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztRQUV6QixLQUFJLENBQUMsWUFBWSxHQUFHLElBQUkseURBQTBCLENBQUMsS0FBSSxDQUFDLE9BQU8sRUFBRSxLQUFJLENBQUMsT0FBTyxFQUFFLFVBQUMsS0FBaUM7WUFDN0csRUFBRSxDQUFBLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7Z0JBQ2xCLEtBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLEVBQUUsS0FBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3hELENBQUM7WUFBQSxJQUFJLENBQUEsQ0FBQztnQkFDRixLQUFJLENBQUMseUJBQXlCLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDNUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDOztJQUNQLENBQUM7SUFFRCxpQ0FBTyxHQUFQO1FBQ1UsT0FBTyxDQUFDLEtBQU0sQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRSxHQUFHLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLEdBQUcsV0FBVyxDQUFDLENBQUM7UUFFckYsSUFBSSxDQUFDO1lBQ0QsR0FBRyxDQUFBLENBQW1CLFVBQWdCLEVBQWhCLEtBQUEsSUFBSSxDQUFDLFdBQVcsRUFBaEIsY0FBZ0IsRUFBaEIsSUFBZ0I7Z0JBQWxDLElBQUksVUFBVSxTQUFBO2dCQUNkLFVBQVUsQ0FBQyxPQUFPLEVBQUUsQ0FBQzthQUN4QjtRQUNMLENBQUM7Z0JBQU8sQ0FBQztZQUNMLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUN2QixDQUFDO0lBQ0wsQ0FBQztJQUNMLHNCQUFDO0FBQUQsQ0EvQkEsQUErQkMsQ0EvQm9DLHFEQUF3QixHQStCNUQ7QUEvQlksMENBQWU7Ozs7O0FDTDVCLGtCQUFlLGdCQUFnQixDQUFDO0FBS2hDO0lBQUE7SUE0SUEsQ0FBQztJQXZJVSxrQ0FBaUIsR0FBeEIsVUFBeUIsV0FBb0IsRUFBRSxjQUE4QjtRQUN6RSxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsRUFBRSxjQUFjLENBQUMsQ0FBQztJQUM3RSxDQUFDO0lBRU0sd0NBQXVCLEdBQTlCLFVBQStCLFdBQW9CLEVBQUUsY0FBOEI7UUFDL0UsTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyx1QkFBdUIsQ0FBQyxXQUFXLEVBQUUsY0FBYyxDQUFDLENBQUM7SUFDbkYsQ0FBQztJQUVjLDRCQUFXLEdBQTFCO1FBQ0ksTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDO0lBQ3JFLENBQUM7SUFFRCw0Q0FBaUIsR0FBakIsVUFBa0IsT0FBZ0IsRUFBRSxjQUE4QjtRQUM5RCxNQUFNLENBQUEsQ0FBQyxPQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzVCO2dCQUNJLE1BQU0sSUFBSSxTQUFTLENBQUMsZ0JBQWdCLENBQUMsa0NBQWtDLENBQUMsQ0FBQztZQUU3RSxLQUFLLFFBQVE7Z0JBQ1QsSUFBSSxXQUFXLEdBQW1CLGNBQWMsQ0FBQztnQkFDakQsTUFBTSxDQUFDLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFFdkUsS0FBSyxRQUFRO2dCQUNULElBQUksTUFBTSxHQUFXLGNBQWMsQ0FBQztnQkFDcEMsTUFBTSxDQUFDLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7WUFFN0QsS0FBSyxVQUFVO2dCQUNYLElBQUksYUFBYSxHQUFrQixjQUFjLENBQUM7Z0JBQ2xELE1BQU0sQ0FBQyxJQUFJLENBQUMsa0NBQWtDLENBQUMsT0FBTyxFQUFFLGFBQWEsQ0FBQyxDQUFDO1FBQy9FLENBQUM7SUFDTCxDQUFDO0lBRUQsa0RBQXVCLEdBQXZCLFVBQXdCLE9BQWdCLEVBQUUsY0FBOEI7UUFDcEUsTUFBTSxDQUFBLENBQUMsT0FBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUM1QjtnQkFDSSxNQUFNLElBQUksU0FBUyxDQUFDLGdCQUFnQixDQUFDLGtDQUFrQyxDQUFDLENBQUM7WUFFN0UsS0FBSyxRQUFRO2dCQUNULElBQUksV0FBVyxHQUFtQixjQUFjLENBQUM7Z0JBQ2pELE1BQU0sQ0FBQyxJQUFJLENBQUMsc0NBQXNDLENBQUMsT0FBTyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1lBRTdFLEtBQUssUUFBUTtnQkFDVCxJQUFJLE1BQU0sR0FBVyxjQUFjLENBQUM7Z0JBQ3BDLE1BQU0sQ0FBQyxJQUFJLENBQUMsaUNBQWlDLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBRW5FLEtBQUssVUFBVTtnQkFDWCxJQUFJLGFBQWEsR0FBa0IsY0FBYyxDQUFDO2dCQUNsRCxNQUFNLENBQUMsSUFBSSxDQUFDLHdDQUF3QyxDQUFDLE9BQU8sRUFBRSxhQUFhLENBQUMsQ0FBQztRQUNyRixDQUFDO0lBQ0wsQ0FBQztJQUVPLDJEQUFnQyxHQUF4QyxVQUF5QyxPQUFnQixFQUFFLFdBQW1CO1FBQzFFLEVBQUUsQ0FBQSxDQUFDLE9BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQztZQUN4QyxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUN4QyxDQUFDO1FBQUEsSUFBSSxDQUFBLENBQUM7WUFDRixNQUFNLENBQUMsbUJBQW1CLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQ2hGLENBQUM7SUFDTCxDQUFDO0lBRU8sc0RBQTJCLEdBQW5DLFVBQW9DLE9BQWdCLEVBQUUsTUFBYztRQUNoRSxFQUFFLENBQUEsQ0FBQyxNQUFNLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQztZQUNqQixNQUFNLENBQUMsS0FBSyxDQUFDO1FBQ2pCLENBQUM7UUFBQSxJQUFJLENBQUEsQ0FBQztZQUNGLEVBQUUsQ0FBQSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3JCLElBQUksU0FBUyxHQUFtQixNQUFNLENBQUM7Z0JBRXZDLEVBQUUsQ0FBQSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxJQUFJLFNBQVMsQ0FBQyxDQUFDLENBQUMsWUFBWSxPQUFPLENBQUMsQ0FBQyxDQUFDO29CQUMzRCxNQUFNLENBQUMsbUJBQW1CLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFDO2dCQUNuRCxDQUFDO2dCQUFBLElBQUksQ0FBQSxDQUFDO29CQUNGLE1BQU0sSUFBSSxTQUFTLENBQUMsZ0JBQWdCLENBQUMsa0NBQWtDLENBQUMsQ0FBQztnQkFDN0UsQ0FBQztZQUNMLENBQUM7WUFBQSxJQUFJLENBQUEsQ0FBQztnQkFDRixNQUFNLElBQUksU0FBUyxDQUFDLGdCQUFnQixDQUFDLGtDQUFrQyxDQUFDLENBQUM7WUFDN0UsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0lBRU8sNkRBQWtDLEdBQTFDLFVBQTJDLE9BQWdCLEVBQUUsYUFBNEI7UUFDckYsSUFBSSxhQUFhLEdBQUcsYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRTNDLEVBQUUsQ0FBQSxDQUFDLE9BQU0sQ0FBQyxhQUFhLENBQUMsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDO1lBQ3JDLElBQUksT0FBTyxHQUFZLGFBQWEsQ0FBQztZQUNyQyxNQUFNLENBQUMsT0FBTyxDQUFDO1FBQ25CLENBQUM7UUFBQSxJQUFJLENBQUEsQ0FBQztZQUNGLElBQUksY0FBYyxHQUFtQixhQUFhLENBQUM7WUFDbkQsTUFBTSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPLEVBQUUsY0FBYyxDQUFDLENBQUM7UUFDM0QsQ0FBQztJQUNMLENBQUM7SUFFTyxpRUFBc0MsR0FBOUMsVUFBK0MsT0FBZ0IsRUFBRSxXQUFtQjtRQUNoRixNQUFNLENBQUMsT0FBTyxDQUFVLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO0lBQ25FLENBQUM7SUFFTyw0REFBaUMsR0FBekMsVUFBMEMsUUFBaUIsRUFBRSxNQUFjO1FBQ3ZFLEVBQUUsQ0FBQSxDQUFDLE1BQU0sS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBQ2pCLE1BQU0sQ0FBQyxFQUFFLENBQUM7UUFDZCxDQUFDO1FBQUEsSUFBSSxDQUFBLENBQUM7WUFDRixFQUFFLENBQUEsQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNyQixJQUFJLFNBQVMsR0FBbUIsTUFBTSxDQUFDO2dCQUV2QyxFQUFFLENBQUEsQ0FBQyxTQUFTLENBQUMsTUFBTSxLQUFLLENBQUMsSUFBSSxTQUFTLENBQUMsQ0FBQyxDQUFDLFlBQVksT0FBTyxDQUFDLENBQUMsQ0FBQztvQkFDM0QsTUFBTSxDQUFDLE9BQU8sQ0FBVSxTQUFTLENBQUMsQ0FBQztnQkFDdkMsQ0FBQztnQkFBQSxJQUFJLENBQUEsQ0FBQztvQkFDRixNQUFNLElBQUksU0FBUyxDQUFDLGdCQUFnQixDQUFDLGtDQUFrQyxDQUFDLENBQUM7Z0JBQzdFLENBQUM7WUFDTCxDQUFDO1lBQUEsSUFBSSxDQUFBLENBQUM7Z0JBQ0YsTUFBTSxJQUFJLFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO1lBQzdFLENBQUM7UUFDTCxDQUFDO0lBQ0wsQ0FBQztJQUVPLG1FQUF3QyxHQUFoRCxVQUFpRCxPQUFnQixFQUFFLGFBQTRCO1FBQzNGLElBQUksUUFBUSxHQUFjLEVBQUUsQ0FBQztRQUM3QixJQUFJLFFBQVEsR0FBRyxPQUFPLENBQUMsUUFBUSxDQUFDO1FBRWhDLEdBQUcsQ0FBQSxDQUFDLElBQUksS0FBSyxHQUFHLENBQUMsRUFBRSxRQUFNLEdBQUcsUUFBUSxDQUFDLE1BQU0sRUFBRSxLQUFLLEdBQUcsUUFBTSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUM7WUFDbkUsSUFBSSxLQUFLLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRTVCLEVBQUUsQ0FBQSxDQUFDLEtBQUssWUFBWSxPQUFPLENBQUMsQ0FBQyxDQUFDO2dCQUMxQixJQUFJLFNBQU8sR0FBWSxLQUFLLENBQUM7Z0JBQzdCLElBQUksYUFBYSxHQUFHLGFBQWEsQ0FBQyxTQUFPLENBQUMsQ0FBQztnQkFFM0MsRUFBRSxDQUFBLENBQUMsT0FBTSxDQUFDLGFBQWEsQ0FBQyxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUM7b0JBQ3JDLElBQUksT0FBTyxHQUFZLGFBQWEsQ0FBQztvQkFFckMsRUFBRSxDQUFBLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQzt3QkFDVCxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQU8sQ0FBQyxDQUFDO29CQUMzQixDQUFDO2dCQUNMLENBQUM7Z0JBQUEsSUFBSSxDQUFBLENBQUM7b0JBQ0YsUUFBUSxDQUFDLElBQUksT0FBYixRQUFRLEVBQVMsSUFBSSxDQUFDLHVCQUF1QixDQUFDLFNBQU8sRUFBRSxhQUFhLENBQUMsRUFBRTtnQkFDM0UsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO1FBRUQsTUFBTSxDQUFDLFFBQVEsQ0FBQztJQUNwQixDQUFDO0lBQ0wsdUJBQUM7QUFBRCxDQTVJQSxBQTRJQztBQXpJMkIsbURBQWtDLEdBQUcseVlBQXlZLENBQUM7QUFIOWIsNENBQWdCO0FBOEk3QixxQkFBcUIsS0FBVTtJQUMzQixNQUFNLENBQUMsT0FBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLFFBQVEsSUFBSSxPQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLFFBQVEsQ0FBQztBQUMzRSxDQUFDO0FBRUQsaUJBQW9CLFNBQXVCO0lBQ3ZDLEVBQUUsQ0FBQSxDQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDeEIsTUFBTSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDcEQsQ0FBQztJQUFBLElBQUksQ0FBQSxDQUFDO1FBQ0YsTUFBTSxJQUFJLFNBQVMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO0lBQzlDLENBQUM7QUFDTCxDQUFDO0FBRUQsNkJBQTZCLFFBQXdCLEVBQUcsTUFBVztJQUMvRCxNQUFNLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztBQUNqRSxDQUFDOzs7OztBQ2pLRCwwREFBK0U7QUFTdEUsZ0RBQVc7QUFScEIsc0VBQW9FO0FBQ3BFLDBFQUF3RTtBQUN4RSxnRUFBNEU7QUFHNUUsd0VBQXNFO0FBQ3RFLG9FQUFrRTtBQU1qRSxDQUFDO0FBRUY7SUFhSSxlQUFZLE9BQWdCLEVBQUUsUUFBd0I7UUFIOUMsZ0JBQVcsR0FBWSxLQUFLLENBQUM7UUFDN0IsaUJBQVksR0FBa0IsRUFBRSxDQUFDO1FBR3JDLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBRXZCLEVBQUUsQ0FBQSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7WUFDVixRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzVDLENBQUM7SUFDTCxDQUFDO0lBbEJNLG9CQUFjLEdBQXJCLFVBQXNCLE9BQWdCO1FBQ2xDLElBQUksS0FBSyxHQUFHLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQy9CLEtBQUssQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUVqQixNQUFNLENBQUMsS0FBSyxDQUFDO0lBQ2pCLENBQUM7SUFlRCwwQkFBVSxHQUFWO1FBQ0ksTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUM7SUFDeEIsQ0FBQztJQUVELCtCQUFlLEdBQWY7UUFDSSxNQUFNLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQztJQUM3QixDQUFDO0lBRUQsdUJBQU8sR0FBUDtRQUNJLEVBQUUsQ0FBQSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1lBQ1osT0FBTyxDQUFDLEtBQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQ25ELENBQUM7UUFBQSxJQUFJLENBQUEsQ0FBQztZQUNJLE9BQU8sQ0FBQyxLQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxZQUFZLENBQUMsQ0FBQztRQUNyRCxDQUFDO1FBRUQsSUFBSSxDQUFDO1lBQ0QsR0FBRyxDQUFBLENBQW9CLFVBQWlCLEVBQWpCLEtBQUEsSUFBSSxDQUFDLFlBQVksRUFBakIsY0FBaUIsRUFBakIsSUFBaUI7Z0JBQXBDLElBQUksV0FBVyxTQUFBO2dCQUNmLFdBQVcsQ0FBQyxPQUFPLEVBQUUsQ0FBQzthQUN6QjtRQUNMLENBQUM7Z0JBQU8sQ0FBQztZQUNDLE9BQU8sQ0FBQyxRQUFTLEVBQUUsQ0FBQztRQUM5QixDQUFDO0lBQ0wsQ0FBQztJQUVELHdCQUFRLEdBQVI7UUFDSSxFQUFFLENBQUEsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1lBQ25CLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDO1lBRXhCLEdBQUcsQ0FBQSxDQUFvQixVQUFpQixFQUFqQixLQUFBLElBQUksQ0FBQyxZQUFZLEVBQWpCLGNBQWlCLEVBQWpCLElBQWlCO2dCQUFwQyxJQUFJLFdBQVcsU0FBQTtnQkFDZixXQUFXLENBQUMsUUFBUSxFQUFFLENBQUM7YUFDMUI7UUFDTCxDQUFDO0lBQ0wsQ0FBQztJQUVELDBCQUFVLEdBQVY7UUFDSSxFQUFFLENBQUEsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQztZQUNsQixJQUFJLENBQUMsV0FBVyxHQUFHLEtBQUssQ0FBQztZQUV6QixHQUFHLENBQUEsQ0FBb0IsVUFBaUIsRUFBakIsS0FBQSxJQUFJLENBQUMsWUFBWSxFQUFqQixjQUFpQixFQUFqQixJQUFpQjtnQkFBcEMsSUFBSSxXQUFXLFNBQUE7Z0JBQ2YsV0FBVyxDQUFDLFVBQVUsRUFBRSxDQUFDO2FBQzVCO1FBQ0wsQ0FBQztJQUNMLENBQUM7SUFFRCx3QkFBUSxHQUFSO1FBQ0ksSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ2xCLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO0lBQ2pDLENBQUM7SUFFRCxxQkFBSyxHQUFMLFVBQU0sUUFBOEI7UUFDaEMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLG9DQUFnQixDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQztRQUVsRSxNQUFNLENBQUMsSUFBSSxDQUFDO0lBQ2hCLENBQUM7SUFFRCx1QkFBTyxHQUFQLFVBQVEsUUFBOEI7UUFDbEMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLHdDQUFrQixDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQztRQUVwRSxNQUFNLENBQUMsSUFBSSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxzQkFBTSxHQUFOLFVBQU8sT0FBdUIsRUFBRSxRQUF1QjtRQUNuRCxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksc0NBQWlCLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQztRQUU1RSxNQUFNLENBQUMsSUFBSSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxvQkFBSSxHQUFKLFVBQUssT0FBdUIsRUFBRSxRQUF1QjtRQUN2RCxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksa0NBQWUsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFDO1FBRXBFLE1BQU0sQ0FBQyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUlELGtCQUFFLEdBQUYsVUFBRyxZQUEwQixFQUFFLHdCQUErRCxFQUFFLGFBQW9DO1FBQ2hJLElBQUksY0FBYyxHQUFHLFNBQVMsQ0FBQyxNQUFNLENBQUM7UUFFdEMsTUFBTSxDQUFBLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQztZQUNwQixLQUFLLENBQUM7Z0JBQ0YsTUFBTSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxZQUFZLEVBQXdCLHdCQUF3QixDQUFDLENBQUM7WUFDakcsS0FBSyxDQUFDO2dCQUNGLE1BQU0sQ0FBQyxJQUFJLENBQUMsb0JBQW9CLENBQUMsWUFBWSxFQUFrQix3QkFBd0IsRUFBd0IsYUFBYSxDQUFDLENBQUM7WUFDbEk7Z0JBQ0ksTUFBTSxJQUFJLFNBQVMsQ0FBQyxvRUFBb0UsR0FBRyxjQUFjLEdBQUcsV0FBVyxDQUFDLENBQUM7UUFDakksQ0FBQztJQUNMLENBQUM7SUFFTyxrQ0FBa0IsR0FBMUIsVUFBMkIsWUFBMEIsRUFBRSxRQUE4QjtRQUNqRixJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksOEJBQWEsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLFlBQVksRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFDO1FBRTdFLE1BQU0sQ0FBQyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVPLG9DQUFvQixHQUE1QixVQUE2QixZQUEwQixFQUFFLGNBQThCLEVBQUUsUUFBOEI7UUFDbkgsSUFBSSxDQUFDLE1BQU0sQ0FBQyxjQUFjLEVBQUUsVUFBQyxLQUFLO1lBQzlCLEtBQUssQ0FBQyxFQUFFLENBQUMsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQ3JDLENBQUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxDQUFDLElBQUksQ0FBQztJQUNoQixDQUFDO0lBRU8sOEJBQWMsR0FBdEIsVUFBdUIsV0FBd0I7UUFDM0MsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUM7UUFFcEMsRUFBRSxDQUFBLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7WUFDbEIsV0FBVyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQzNCLENBQUM7SUFDTCxDQUFDO0lBRU8saUNBQWlCLEdBQXpCLFVBQTBCLFdBQXdCO1FBQzlDLElBQUksS0FBSyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBRW5ELEVBQUUsQ0FBQSxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ1osSUFBSSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7UUFFRCxXQUFXLENBQUMsVUFBVSxFQUFFLENBQUM7SUFDN0IsQ0FBQztJQUVPLHFDQUFxQixHQUE3QjtRQUNJLElBQUksV0FBd0IsQ0FBQztRQUU3QixPQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDdkMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQ3hDLENBQUM7SUFDTCxDQUFDO0lBQ0wsWUFBQztBQUFELENBcEpBLEFBb0pDLElBQUE7QUFwSlksc0JBQUs7Ozs7Ozs7Ozs7Ozs7OztBQ2ZsQiwrQ0FBdUY7QUEyRTlFLG1EQUFZO0FBQXdCLDZEQUFpQjtBQXBFOUQsSUFBSSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLGVBQWU7QUFFcEU7SUFBMEQsK0NBQVk7SUFjbEUscUNBQVksT0FBZ0IsRUFBRSxRQUE4QjtRQUE1RCxZQUNJLGtCQUFNLE9BQU8sRUFBRSxRQUFRLENBQUMsU0FPM0I7UUFkTyxpQkFBVyxHQUFhLEtBQUssQ0FBQztRQUM5QiwyQkFBcUIsR0FBUyxJQUFJLENBQUM7UUFRdkMsS0FBSSxDQUFDLGdCQUFnQixHQUFHO1lBQ3BCLEtBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBQ2hDLENBQUMsQ0FBQTtRQUVELEtBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLGdCQUFnQixDQUFDLEtBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDOztJQUN4RSxDQUFDO0lBRVMsb0RBQWMsR0FBeEI7UUFDSSxFQUFFLENBQUEsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1lBQ25CLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSwyQkFBMkIsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO1lBRTlGLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDO1FBQzVCLENBQUM7SUFDTCxDQUFDO0lBRVMsbURBQWEsR0FBdkI7UUFDSSxFQUFFLENBQUEsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQztZQUNsQixJQUFJLENBQUMsZ0JBQWdCLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDbkMsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFFMUIsSUFBSSxDQUFDLFdBQVcsR0FBRyxLQUFLLENBQUM7UUFDN0IsQ0FBQztJQUNMLENBQUM7SUFJTywwREFBb0IsR0FBNUI7UUFBQSxpQkFXQztRQVZHLEVBQUUsQ0FBQSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBQ3JDLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxVQUFVLENBQUM7Z0JBQ3BDLElBQUksQ0FBQztvQkFDRCxLQUFJLENBQUMsZ0JBQWdCLENBQUMsV0FBVyxFQUFFLENBQUM7b0JBQ3BDLEtBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztnQkFDM0IsQ0FBQzt3QkFBTyxDQUFDO29CQUNMLEtBQUksQ0FBQyxxQkFBcUIsR0FBRyxJQUFJLENBQUM7Z0JBQ3RDLENBQUM7WUFDTCxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDVixDQUFDO0lBQ0wsQ0FBQztJQUVPLHdEQUFrQixHQUExQjtRQUNJLEVBQUUsQ0FBQSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBQ3JDLFlBQVksQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQztZQUN6QyxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxDQUFDO1lBRWxDLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUMzQixDQUFDO0lBQ0wsQ0FBQztJQUNMLGtDQUFDO0FBQUQsQ0FoRUEsQUFnRUMsQ0FoRXlELDJCQUFZO0FBQ2xELGdEQUFvQixHQUF5QjtJQUN6RCxTQUFTLEVBQUUsSUFBSTtJQUNmLFVBQVUsRUFBRSxJQUFJO0lBQ2hCLGFBQWEsRUFBRSxJQUFJO0lBQ25CLE9BQU8sRUFBRSxJQUFJO0NBQ2hCLENBQUM7QUFOZ0Isa0VBQTJCOzs7Ozs7Ozs7Ozs7Ozs7QUNUakQsaUZBQXVIO0FBQ3ZILDBEQUF3RTtBQUV4RTtJQUFnRCw4Q0FBMkI7SUFNdkUsb0NBQVksT0FBZ0IsRUFBRSxPQUF1QixFQUFFLFFBQThCO1FBQXJGLFlBQ0ksa0JBQU0sT0FBTyxFQUFFLFFBQVEsQ0FBQyxTQUczQjtRQVBPLGlCQUFXLEdBQVksS0FBSyxDQUFDO1FBQzdCLHVCQUFpQixHQUFZLEtBQUssQ0FBQztRQUt2QyxLQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQzs7SUFDM0IsQ0FBQztJQUVELDRDQUFPLEdBQVA7UUFDSSxFQUFFLENBQUEsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1lBQ25CLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLENBQUMsd0JBQXdCLEVBQUUsQ0FBQyxDQUFDO1lBQzlELElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUV0QixJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQztRQUM1QixDQUFDO0lBQ0wsQ0FBQztJQUVELCtDQUFVLEdBQVY7UUFDSSxFQUFFLENBQUEsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQztZQUNsQixJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDckIsSUFBSSxDQUFDLHVCQUF1QixDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRXBDLElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSyxDQUFDO1FBQzdCLENBQUM7SUFDTCxDQUFDO0lBRVMsb0RBQWUsR0FBekI7UUFDSSxJQUFJLENBQUMsdUJBQXVCLENBQUMsSUFBSSxDQUFDLHdCQUF3QixFQUFFLENBQUMsQ0FBQztJQUNsRSxDQUFDO0lBRU8sNERBQXVCLEdBQS9CLFVBQWdDLGlCQUEwQjtRQUN0RCxJQUFJLGtCQUFrQixHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQztRQUNoRCxJQUFJLENBQUMsaUJBQWlCLEdBQUcsaUJBQWlCLENBQUM7UUFFM0MsRUFBRSxDQUFBLENBQUMsa0JBQWtCLEtBQUssaUJBQWlCLENBQUMsQ0FBQyxDQUFDO1lBQzFDLElBQUksT0FBSyxHQUFHLElBQUksMEJBQTBCLENBQUMsSUFBSSxFQUFFLGlCQUFpQixDQUFDLENBQUM7WUFFcEUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFLLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7SUFDTCxDQUFDO0lBRU8sNkRBQXdCLEdBQWhDO1FBQ0ksTUFBTSxDQUFDLG9DQUFnQixDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQzFFLENBQUM7SUFDTCxpQ0FBQztBQUFELENBaERBLEFBZ0RDLENBaEQrQywyREFBMkIsR0FnRDFFO0FBaERZLGdFQUEwQjtBQWtEdkM7SUFBZ0QsOENBQWlCO0lBRzdELG9DQUFZLDBCQUFzRCxFQUFFLFVBQW1CO1FBQXZGLFlBQ0ksa0JBQU0sMEJBQTBCLEVBQUUsNEJBQTRCLENBQUMsU0FHbEU7UUFERyxLQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQzs7SUFDakMsQ0FBQztJQUNMLGlDQUFDO0FBQUQsQ0FSQSxBQVFDLENBUitDLGlEQUFpQixHQVFoRTtBQVJZLGdFQUEwQjs7Ozs7Ozs7Ozs7Ozs7O0FDckR2QywrQ0FBb0U7QUFJcEU7SUFBdUMscUNBQVk7SUFPL0MsMkJBQVksT0FBZ0IsRUFBRSxZQUEwQixFQUFFLFFBQThCO1FBQXhGLFlBQ0ksa0JBQU0sT0FBTyxFQUFFLFFBQVEsQ0FBQyxTQVEzQjtRQVpPLGlCQUFXLEdBQWEsS0FBSyxDQUFDO1FBTWxDLEtBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFDO1FBQ2pDLEtBQUksQ0FBQyxVQUFVLEdBQUcsS0FBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUU1RCxLQUFJLENBQUMsYUFBYSxHQUFHLFVBQUMsS0FBWTtZQUM5QixLQUFJLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzVCLENBQUMsQ0FBQTs7SUFDTCxDQUFDO0lBRUQsbUNBQU8sR0FBUDtRQUNJLEVBQUUsQ0FBQSxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7WUFDbkIsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLENBQUM7WUFFeEIsR0FBRyxDQUFBLENBQWtCLFVBQWUsRUFBZixLQUFBLElBQUksQ0FBQyxVQUFVLEVBQWYsY0FBZSxFQUFmLElBQWU7Z0JBQWhDLElBQUksU0FBUyxTQUFBO2dCQUNiLElBQUksQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUUsS0FBSyxDQUFDLENBQUM7YUFDdkU7UUFDTCxDQUFDO0lBQ0wsQ0FBQztJQUVELHNDQUFVLEdBQVY7UUFDSSxFQUFFLENBQUEsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQztZQUNsQixHQUFHLENBQUEsQ0FBa0IsVUFBZSxFQUFmLEtBQUEsSUFBSSxDQUFDLFVBQVUsRUFBZixjQUFlLEVBQWYsSUFBZTtnQkFBaEMsSUFBSSxTQUFTLFNBQUE7Z0JBQ2IsSUFBSSxDQUFDLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsQ0FBQzthQUMxRTtZQUVELElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSyxDQUFDO1FBQzdCLENBQUM7SUFDTCxDQUFDO0lBRU8sdUNBQVcsR0FBbkIsVUFBb0IsS0FBWTtRQUM1QixJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDdkMsQ0FBQztJQUVPLDZDQUFpQixHQUF6QixVQUEwQixZQUEwQjtRQUNoRCxzREFBc0Q7UUFDdEQsTUFBTSxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDbkMsQ0FBQztJQUNMLHdCQUFDO0FBQUQsQ0E5Q0EsQUE4Q0MsQ0E5Q3NDLDJCQUFZLEdBOENsRDtBQTlDWSw4Q0FBaUI7Ozs7Ozs7Ozs7Ozs7OztBQ0o5QixpRkFBdUg7QUFDdkgsMERBQXdFO0FBSXhFO0lBQWtELGdEQUEyQjtJQU16RSxzQ0FBWSxPQUFnQixFQUFFLE9BQXVCLEVBQUUsUUFBOEI7UUFBckYsWUFDSSxrQkFBTSxPQUFPLEVBQUUsUUFBUSxDQUFDLFNBRzNCO1FBUE8saUJBQVcsR0FBWSxLQUFLLENBQUM7UUFDN0Isc0JBQWdCLEdBQWMsRUFBRSxDQUFDO1FBS3JDLEtBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDOztJQUMzQixDQUFDO0lBRUQsOENBQU8sR0FBUDtRQUNJLEVBQUUsQ0FBQSxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7WUFDbkIsSUFBSSxDQUFDLHNCQUFzQixDQUFDLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFDLENBQUM7WUFDNUQsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBRXRCLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDO1FBQzVCLENBQUM7SUFDTCxDQUFDO0lBRUQsaURBQVUsR0FBVjtRQUNJLEVBQUUsQ0FBQSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1lBQ2xCLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNyQixJQUFJLENBQUMsc0JBQXNCLENBQUMsRUFBRSxDQUFDLENBQUM7WUFFaEMsSUFBSSxDQUFDLFdBQVcsR0FBRyxLQUFLLENBQUM7UUFDN0IsQ0FBQztJQUNMLENBQUM7SUFFUyxzREFBZSxHQUF6QjtRQUNJLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsQ0FBQyxDQUFDO0lBQ2hFLENBQUM7SUFFTyw2REFBc0IsR0FBOUIsVUFBK0IsZ0JBQTJCO1FBQ3RELElBQUksMEJBQTBCLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDO1FBRXZELElBQUksYUFBYSxHQUFHLGFBQWEsQ0FBQyxnQkFBZ0IsRUFBRSwwQkFBMEIsQ0FBQyxDQUFDO1FBQ2hGLElBQUksZUFBZSxHQUFHLGFBQWEsQ0FBQywwQkFBMEIsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO1FBRWxGLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQztRQUV6QyxFQUFFLENBQUEsQ0FBQyxhQUFhLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxlQUFlLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDeEQsSUFBSSxPQUFLLEdBQUcsSUFBSSw0QkFBNEIsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFLGVBQWUsQ0FBQyxDQUFDO1lBRW5GLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBSyxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUN2QyxDQUFDO0lBQ0wsQ0FBQztJQUVPLDhEQUF1QixHQUEvQjtRQUNJLE1BQU0sQ0FBQyxvQ0FBZ0IsQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNoRixDQUFDO0lBQ0wsbUNBQUM7QUFBRCxDQXBEQSxBQW9EQyxDQXBEaUQsMkRBQTJCLEdBb0Q1RTtBQXBEWSxvRUFBNEI7QUFzRHpDO0lBQWtELGdEQUFpQjtJQUkvRCxzQ0FBWSw0QkFBMEQsRUFBRSxhQUF3QixFQUFFLGVBQTBCO1FBQTVILFlBQ0ksa0JBQU0sNEJBQTRCLEVBQUUseUJBQXlCLENBQUMsU0FJakU7UUFGRyxLQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQztRQUNuQyxLQUFJLENBQUMsZUFBZSxHQUFHLGVBQWUsQ0FBQzs7SUFDM0MsQ0FBQztJQUNMLG1DQUFDO0FBQUQsQ0FWQSxBQVVDLENBVmlELGlEQUFpQixHQVVsRTtBQVZZLG9FQUE0QjtBQVl6Qyx1QkFBMEIsT0FBWSxFQUFFLFVBQWU7SUFDbkQsSUFBSSxVQUFVLEdBQVEsRUFBRSxDQUFDO0lBRXpCLEdBQUcsQ0FBQSxDQUFlLFVBQU8sRUFBUCxtQkFBTyxFQUFQLHFCQUFPLEVBQVAsSUFBTztRQUFyQixJQUFJLE1BQU0sZ0JBQUE7UUFDVixFQUFFLENBQUEsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNuQyxVQUFVLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQzVCLENBQUM7S0FDSjtJQUVELE1BQU0sQ0FBQyxVQUFVLENBQUM7QUFDdEIsQ0FBQzs7Ozs7QUNqRkQ7SUFJSSxzQkFBWSxPQUFnQixFQUFFLFFBQThCO1FBQ3hELElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO0lBQzdCLENBQUM7SUFJTCxtQkFBQztBQUFELENBWEEsQUFXQyxJQUFBO0FBWHFCLG9DQUFZO0FBaUJsQztJQUlJLDJCQUFZLFlBQTBCLEVBQUUsSUFBWTtRQUNoRCxJQUFJLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQztRQUNqQyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztJQUNyQixDQUFDO0lBQ0wsd0JBQUM7QUFBRCxDQVJBLEFBUUMsSUFBQTtBQVJZLDhDQUFpQjs7Ozs7Ozs7Ozs7Ozs7O0FDakI5QiwrQ0FBdUY7QUFTdkY7SUFBbUQsaURBQWlCO0lBSWhFLHVDQUFZLG1CQUF3QyxFQUFFLE9BQWdCLEVBQUUsV0FBb0I7UUFBNUYsWUFDSSxrQkFBTSxtQkFBbUIsRUFBRSxrQkFBa0IsQ0FBQyxTQUlqRDtRQUZHLEtBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLEtBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFDOztJQUNuQyxDQUFDO0lBQ0wsb0NBQUM7QUFBRCxDQVZBLEFBVUMsQ0FWa0QsZ0NBQWlCLEdBVW5FO0FBVlksc0VBQTZCO0FBWTFDO0lBQXlDLHVDQUFZO0lBSWpELDZCQUFZLE9BQWdCLEVBQUUsTUFBd0MsRUFBRSxRQUE4QjtRQUF0RyxZQUNJLGtCQUFNLE9BQU8sRUFBRSxRQUFRLENBQUMsU0FHM0I7UUFQTyxpQkFBVyxHQUFZLEtBQUssQ0FBQztRQU1qQyxLQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQzs7SUFDekIsQ0FBQztJQUVELHFDQUFPLEdBQVA7UUFDSSxFQUFFLENBQUEsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1lBQ25CLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDO1lBRXhCLEVBQUUsQ0FBQSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztnQkFDdkIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsa0NBQWtDLEVBQUUsRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDM0UsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0lBRUQsd0NBQVUsR0FBVjtRQUNJLEVBQUUsQ0FBQSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1lBQ2xCLElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSyxDQUFDO1lBRXpCLEVBQUUsQ0FBQSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQztnQkFDMUIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsa0NBQWtDLEVBQUUsRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDM0UsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0lBRU8sZ0VBQWtDLEdBQTFDO1FBQ0ksTUFBTSxDQUFDLElBQUksNkJBQTZCLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQ25GLENBQUM7SUFDTCwwQkFBQztBQUFELENBakNBLEFBaUNDLENBakN3QywyQkFBWSxHQWlDcEQ7QUFqQ1ksa0RBQW1CIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsInZhciBNdXRhdGlvbk9ic2VydmVyID0gd2luZG93Lk11dGF0aW9uT2JzZXJ2ZXJcbiAgfHwgd2luZG93LldlYktpdE11dGF0aW9uT2JzZXJ2ZXJcbiAgfHwgd2luZG93Lk1vek11dGF0aW9uT2JzZXJ2ZXI7XG5cbi8qXG4gKiBDb3B5cmlnaHQgMjAxMiBUaGUgUG9seW1lciBBdXRob3JzLiBBbGwgcmlnaHRzIHJlc2VydmVkLlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJlbmVkIGJ5IGEgQlNELXN0eWxlXG4gKiBsaWNlbnNlIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUuXG4gKi9cblxudmFyIFdlYWtNYXAgPSB3aW5kb3cuV2Vha01hcDtcblxuaWYgKHR5cGVvZiBXZWFrTWFwID09PSAndW5kZWZpbmVkJykge1xuICB2YXIgZGVmaW5lUHJvcGVydHkgPSBPYmplY3QuZGVmaW5lUHJvcGVydHk7XG4gIHZhciBjb3VudGVyID0gRGF0ZS5ub3coKSAlIDFlOTtcblxuICBXZWFrTWFwID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5uYW1lID0gJ19fc3QnICsgKE1hdGgucmFuZG9tKCkgKiAxZTkgPj4+IDApICsgKGNvdW50ZXIrKyArICdfXycpO1xuICB9O1xuXG4gIFdlYWtNYXAucHJvdG90eXBlID0ge1xuICAgIHNldDogZnVuY3Rpb24oa2V5LCB2YWx1ZSkge1xuICAgICAgdmFyIGVudHJ5ID0ga2V5W3RoaXMubmFtZV07XG4gICAgICBpZiAoZW50cnkgJiYgZW50cnlbMF0gPT09IGtleSlcbiAgICAgICAgZW50cnlbMV0gPSB2YWx1ZTtcbiAgICAgIGVsc2VcbiAgICAgICAgZGVmaW5lUHJvcGVydHkoa2V5LCB0aGlzLm5hbWUsIHt2YWx1ZTogW2tleSwgdmFsdWVdLCB3cml0YWJsZTogdHJ1ZX0pO1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcbiAgICBnZXQ6IGZ1bmN0aW9uKGtleSkge1xuICAgICAgdmFyIGVudHJ5O1xuICAgICAgcmV0dXJuIChlbnRyeSA9IGtleVt0aGlzLm5hbWVdKSAmJiBlbnRyeVswXSA9PT0ga2V5ID9cbiAgICAgICAgICBlbnRyeVsxXSA6IHVuZGVmaW5lZDtcbiAgICB9LFxuICAgICdkZWxldGUnOiBmdW5jdGlvbihrZXkpIHtcbiAgICAgIHZhciBlbnRyeSA9IGtleVt0aGlzLm5hbWVdO1xuICAgICAgaWYgKCFlbnRyeSkgcmV0dXJuIGZhbHNlO1xuICAgICAgdmFyIGhhc1ZhbHVlID0gZW50cnlbMF0gPT09IGtleTtcbiAgICAgIGVudHJ5WzBdID0gZW50cnlbMV0gPSB1bmRlZmluZWQ7XG4gICAgICByZXR1cm4gaGFzVmFsdWU7XG4gICAgfSxcbiAgICBoYXM6IGZ1bmN0aW9uKGtleSkge1xuICAgICAgdmFyIGVudHJ5ID0ga2V5W3RoaXMubmFtZV07XG4gICAgICBpZiAoIWVudHJ5KSByZXR1cm4gZmFsc2U7XG4gICAgICByZXR1cm4gZW50cnlbMF0gPT09IGtleTtcbiAgICB9XG4gIH07XG59XG5cbnZhciByZWdpc3RyYXRpb25zVGFibGUgPSBuZXcgV2Vha01hcCgpO1xuXG4vLyBXZSB1c2Ugc2V0SW1tZWRpYXRlIG9yIHBvc3RNZXNzYWdlIGZvciBvdXIgZnV0dXJlIGNhbGxiYWNrLlxudmFyIHNldEltbWVkaWF0ZSA9IHdpbmRvdy5tc1NldEltbWVkaWF0ZTtcblxuLy8gVXNlIHBvc3QgbWVzc2FnZSB0byBlbXVsYXRlIHNldEltbWVkaWF0ZS5cbmlmICghc2V0SW1tZWRpYXRlKSB7XG4gIHZhciBzZXRJbW1lZGlhdGVRdWV1ZSA9IFtdO1xuICB2YXIgc2VudGluZWwgPSBTdHJpbmcoTWF0aC5yYW5kb20oKSk7XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZnVuY3Rpb24oZSkge1xuICAgIGlmIChlLmRhdGEgPT09IHNlbnRpbmVsKSB7XG4gICAgICB2YXIgcXVldWUgPSBzZXRJbW1lZGlhdGVRdWV1ZTtcbiAgICAgIHNldEltbWVkaWF0ZVF1ZXVlID0gW107XG4gICAgICBxdWV1ZS5mb3JFYWNoKGZ1bmN0aW9uKGZ1bmMpIHtcbiAgICAgICAgZnVuYygpO1xuICAgICAgfSk7XG4gICAgfVxuICB9KTtcbiAgc2V0SW1tZWRpYXRlID0gZnVuY3Rpb24oZnVuYykge1xuICAgIHNldEltbWVkaWF0ZVF1ZXVlLnB1c2goZnVuYyk7XG4gICAgd2luZG93LnBvc3RNZXNzYWdlKHNlbnRpbmVsLCAnKicpO1xuICB9O1xufVxuXG4vLyBUaGlzIGlzIHVzZWQgdG8gZW5zdXJlIHRoYXQgd2UgbmV2ZXIgc2NoZWR1bGUgMiBjYWxsYXMgdG8gc2V0SW1tZWRpYXRlXG52YXIgaXNTY2hlZHVsZWQgPSBmYWxzZTtcblxuLy8gS2VlcCB0cmFjayBvZiBvYnNlcnZlcnMgdGhhdCBuZWVkcyB0byBiZSBub3RpZmllZCBuZXh0IHRpbWUuXG52YXIgc2NoZWR1bGVkT2JzZXJ2ZXJzID0gW107XG5cbi8qKlxuICogU2NoZWR1bGVzIHxkaXNwYXRjaENhbGxiYWNrfCB0byBiZSBjYWxsZWQgaW4gdGhlIGZ1dHVyZS5cbiAqIEBwYXJhbSB7TXV0YXRpb25PYnNlcnZlcn0gb2JzZXJ2ZXJcbiAqL1xuZnVuY3Rpb24gc2NoZWR1bGVDYWxsYmFjayhvYnNlcnZlcikge1xuICBzY2hlZHVsZWRPYnNlcnZlcnMucHVzaChvYnNlcnZlcik7XG4gIGlmICghaXNTY2hlZHVsZWQpIHtcbiAgICBpc1NjaGVkdWxlZCA9IHRydWU7XG4gICAgc2V0SW1tZWRpYXRlKGRpc3BhdGNoQ2FsbGJhY2tzKTtcbiAgfVxufVxuXG5mdW5jdGlvbiB3cmFwSWZOZWVkZWQobm9kZSkge1xuICByZXR1cm4gd2luZG93LlNoYWRvd0RPTVBvbHlmaWxsICYmXG4gICAgICB3aW5kb3cuU2hhZG93RE9NUG9seWZpbGwud3JhcElmTmVlZGVkKG5vZGUpIHx8XG4gICAgICBub2RlO1xufVxuXG5mdW5jdGlvbiBkaXNwYXRjaENhbGxiYWNrcygpIHtcbiAgLy8gaHR0cDovL2RvbS5zcGVjLndoYXR3Zy5vcmcvI211dGF0aW9uLW9ic2VydmVyc1xuXG4gIGlzU2NoZWR1bGVkID0gZmFsc2U7IC8vIFVzZWQgdG8gYWxsb3cgYSBuZXcgc2V0SW1tZWRpYXRlIGNhbGwgYWJvdmUuXG5cbiAgdmFyIG9ic2VydmVycyA9IHNjaGVkdWxlZE9ic2VydmVycztcbiAgc2NoZWR1bGVkT2JzZXJ2ZXJzID0gW107XG4gIC8vIFNvcnQgb2JzZXJ2ZXJzIGJhc2VkIG9uIHRoZWlyIGNyZWF0aW9uIFVJRCAoaW5jcmVtZW50YWwpLlxuICBvYnNlcnZlcnMuc29ydChmdW5jdGlvbihvMSwgbzIpIHtcbiAgICByZXR1cm4gbzEudWlkXyAtIG8yLnVpZF87XG4gIH0pO1xuXG4gIHZhciBhbnlOb25FbXB0eSA9IGZhbHNlO1xuICBvYnNlcnZlcnMuZm9yRWFjaChmdW5jdGlvbihvYnNlcnZlcikge1xuXG4gICAgLy8gMi4xLCAyLjJcbiAgICB2YXIgcXVldWUgPSBvYnNlcnZlci50YWtlUmVjb3JkcygpO1xuICAgIC8vIDIuMy4gUmVtb3ZlIGFsbCB0cmFuc2llbnQgcmVnaXN0ZXJlZCBvYnNlcnZlcnMgd2hvc2Ugb2JzZXJ2ZXIgaXMgbW8uXG4gICAgcmVtb3ZlVHJhbnNpZW50T2JzZXJ2ZXJzRm9yKG9ic2VydmVyKTtcblxuICAgIC8vIDIuNFxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgIG9ic2VydmVyLmNhbGxiYWNrXyhxdWV1ZSwgb2JzZXJ2ZXIpO1xuICAgICAgYW55Tm9uRW1wdHkgPSB0cnVlO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gMy5cbiAgaWYgKGFueU5vbkVtcHR5KVxuICAgIGRpc3BhdGNoQ2FsbGJhY2tzKCk7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZVRyYW5zaWVudE9ic2VydmVyc0ZvcihvYnNlcnZlcikge1xuICBvYnNlcnZlci5ub2Rlc18uZm9yRWFjaChmdW5jdGlvbihub2RlKSB7XG4gICAgdmFyIHJlZ2lzdHJhdGlvbnMgPSByZWdpc3RyYXRpb25zVGFibGUuZ2V0KG5vZGUpO1xuICAgIGlmICghcmVnaXN0cmF0aW9ucylcbiAgICAgIHJldHVybjtcbiAgICByZWdpc3RyYXRpb25zLmZvckVhY2goZnVuY3Rpb24ocmVnaXN0cmF0aW9uKSB7XG4gICAgICBpZiAocmVnaXN0cmF0aW9uLm9ic2VydmVyID09PSBvYnNlcnZlcilcbiAgICAgICAgcmVnaXN0cmF0aW9uLnJlbW92ZVRyYW5zaWVudE9ic2VydmVycygpO1xuICAgIH0pO1xuICB9KTtcbn1cblxuLyoqXG4gKiBUaGlzIGZ1bmN0aW9uIGlzIHVzZWQgZm9yIHRoZSBcIkZvciBlYWNoIHJlZ2lzdGVyZWQgb2JzZXJ2ZXIgb2JzZXJ2ZXIgKHdpdGhcbiAqIG9ic2VydmVyJ3Mgb3B0aW9ucyBhcyBvcHRpb25zKSBpbiB0YXJnZXQncyBsaXN0IG9mIHJlZ2lzdGVyZWQgb2JzZXJ2ZXJzLFxuICogcnVuIHRoZXNlIHN1YnN0ZXBzOlwiIGFuZCB0aGUgXCJGb3IgZWFjaCBhbmNlc3RvciBhbmNlc3RvciBvZiB0YXJnZXQsIGFuZCBmb3JcbiAqIGVhY2ggcmVnaXN0ZXJlZCBvYnNlcnZlciBvYnNlcnZlciAod2l0aCBvcHRpb25zIG9wdGlvbnMpIGluIGFuY2VzdG9yJ3MgbGlzdFxuICogb2YgcmVnaXN0ZXJlZCBvYnNlcnZlcnMsIHJ1biB0aGVzZSBzdWJzdGVwczpcIiBwYXJ0IG9mIHRoZSBhbGdvcml0aG1zLiBUaGVcbiAqIHxvcHRpb25zLnN1YnRyZWV8IGlzIGNoZWNrZWQgdG8gZW5zdXJlIHRoYXQgdGhlIGNhbGxiYWNrIGlzIGNhbGxlZFxuICogY29ycmVjdGx5LlxuICpcbiAqIEBwYXJhbSB7Tm9kZX0gdGFyZ2V0XG4gKiBAcGFyYW0ge2Z1bmN0aW9uKE11dGF0aW9uT2JzZXJ2ZXJJbml0KTpNdXRhdGlvblJlY29yZH0gY2FsbGJhY2tcbiAqL1xuZnVuY3Rpb24gZm9yRWFjaEFuY2VzdG9yQW5kT2JzZXJ2ZXJFbnF1ZXVlUmVjb3JkKHRhcmdldCwgY2FsbGJhY2spIHtcbiAgZm9yICh2YXIgbm9kZSA9IHRhcmdldDsgbm9kZTsgbm9kZSA9IG5vZGUucGFyZW50Tm9kZSkge1xuICAgIHZhciByZWdpc3RyYXRpb25zID0gcmVnaXN0cmF0aW9uc1RhYmxlLmdldChub2RlKTtcblxuICAgIGlmIChyZWdpc3RyYXRpb25zKSB7XG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IHJlZ2lzdHJhdGlvbnMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgdmFyIHJlZ2lzdHJhdGlvbiA9IHJlZ2lzdHJhdGlvbnNbal07XG4gICAgICAgIHZhciBvcHRpb25zID0gcmVnaXN0cmF0aW9uLm9wdGlvbnM7XG5cbiAgICAgICAgLy8gT25seSB0YXJnZXQgaWdub3JlcyBzdWJ0cmVlLlxuICAgICAgICBpZiAobm9kZSAhPT0gdGFyZ2V0ICYmICFvcHRpb25zLnN1YnRyZWUpXG4gICAgICAgICAgY29udGludWU7XG5cbiAgICAgICAgdmFyIHJlY29yZCA9IGNhbGxiYWNrKG9wdGlvbnMpO1xuICAgICAgICBpZiAocmVjb3JkKVxuICAgICAgICAgIHJlZ2lzdHJhdGlvbi5lbnF1ZXVlKHJlY29yZCk7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbnZhciB1aWRDb3VudGVyID0gMDtcblxuLyoqXG4gKiBUaGUgY2xhc3MgdGhhdCBtYXBzIHRvIHRoZSBET00gTXV0YXRpb25PYnNlcnZlciBpbnRlcmZhY2UuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjay5cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBKc011dGF0aW9uT2JzZXJ2ZXIoY2FsbGJhY2spIHtcbiAgdGhpcy5jYWxsYmFja18gPSBjYWxsYmFjaztcbiAgdGhpcy5ub2Rlc18gPSBbXTtcbiAgdGhpcy5yZWNvcmRzXyA9IFtdO1xuICB0aGlzLnVpZF8gPSArK3VpZENvdW50ZXI7XG59XG5cbkpzTXV0YXRpb25PYnNlcnZlci5wcm90b3R5cGUgPSB7XG4gIG9ic2VydmU6IGZ1bmN0aW9uKHRhcmdldCwgb3B0aW9ucykge1xuICAgIHRhcmdldCA9IHdyYXBJZk5lZWRlZCh0YXJnZXQpO1xuXG4gICAgLy8gMS4xXG4gICAgaWYgKCFvcHRpb25zLmNoaWxkTGlzdCAmJiAhb3B0aW9ucy5hdHRyaWJ1dGVzICYmICFvcHRpb25zLmNoYXJhY3RlckRhdGEgfHxcblxuICAgICAgICAvLyAxLjJcbiAgICAgICAgb3B0aW9ucy5hdHRyaWJ1dGVPbGRWYWx1ZSAmJiAhb3B0aW9ucy5hdHRyaWJ1dGVzIHx8XG5cbiAgICAgICAgLy8gMS4zXG4gICAgICAgIG9wdGlvbnMuYXR0cmlidXRlRmlsdGVyICYmIG9wdGlvbnMuYXR0cmlidXRlRmlsdGVyLmxlbmd0aCAmJlxuICAgICAgICAgICAgIW9wdGlvbnMuYXR0cmlidXRlcyB8fFxuXG4gICAgICAgIC8vIDEuNFxuICAgICAgICBvcHRpb25zLmNoYXJhY3RlckRhdGFPbGRWYWx1ZSAmJiAhb3B0aW9ucy5jaGFyYWN0ZXJEYXRhKSB7XG5cbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcigpO1xuICAgIH1cblxuICAgIHZhciByZWdpc3RyYXRpb25zID0gcmVnaXN0cmF0aW9uc1RhYmxlLmdldCh0YXJnZXQpO1xuICAgIGlmICghcmVnaXN0cmF0aW9ucylcbiAgICAgIHJlZ2lzdHJhdGlvbnNUYWJsZS5zZXQodGFyZ2V0LCByZWdpc3RyYXRpb25zID0gW10pO1xuXG4gICAgLy8gMlxuICAgIC8vIElmIHRhcmdldCdzIGxpc3Qgb2YgcmVnaXN0ZXJlZCBvYnNlcnZlcnMgYWxyZWFkeSBpbmNsdWRlcyBhIHJlZ2lzdGVyZWRcbiAgICAvLyBvYnNlcnZlciBhc3NvY2lhdGVkIHdpdGggdGhlIGNvbnRleHQgb2JqZWN0LCByZXBsYWNlIHRoYXQgcmVnaXN0ZXJlZFxuICAgIC8vIG9ic2VydmVyJ3Mgb3B0aW9ucyB3aXRoIG9wdGlvbnMuXG4gICAgdmFyIHJlZ2lzdHJhdGlvbjtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJlZ2lzdHJhdGlvbnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChyZWdpc3RyYXRpb25zW2ldLm9ic2VydmVyID09PSB0aGlzKSB7XG4gICAgICAgIHJlZ2lzdHJhdGlvbiA9IHJlZ2lzdHJhdGlvbnNbaV07XG4gICAgICAgIHJlZ2lzdHJhdGlvbi5yZW1vdmVMaXN0ZW5lcnMoKTtcbiAgICAgICAgcmVnaXN0cmF0aW9uLm9wdGlvbnMgPSBvcHRpb25zO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAzLlxuICAgIC8vIE90aGVyd2lzZSwgYWRkIGEgbmV3IHJlZ2lzdGVyZWQgb2JzZXJ2ZXIgdG8gdGFyZ2V0J3MgbGlzdCBvZiByZWdpc3RlcmVkXG4gICAgLy8gb2JzZXJ2ZXJzIHdpdGggdGhlIGNvbnRleHQgb2JqZWN0IGFzIHRoZSBvYnNlcnZlciBhbmQgb3B0aW9ucyBhcyB0aGVcbiAgICAvLyBvcHRpb25zLCBhbmQgYWRkIHRhcmdldCB0byBjb250ZXh0IG9iamVjdCdzIGxpc3Qgb2Ygbm9kZXMgb24gd2hpY2ggaXRcbiAgICAvLyBpcyByZWdpc3RlcmVkLlxuICAgIGlmICghcmVnaXN0cmF0aW9uKSB7XG4gICAgICByZWdpc3RyYXRpb24gPSBuZXcgUmVnaXN0cmF0aW9uKHRoaXMsIHRhcmdldCwgb3B0aW9ucyk7XG4gICAgICByZWdpc3RyYXRpb25zLnB1c2gocmVnaXN0cmF0aW9uKTtcbiAgICAgIHRoaXMubm9kZXNfLnB1c2godGFyZ2V0KTtcbiAgICB9XG5cbiAgICByZWdpc3RyYXRpb24uYWRkTGlzdGVuZXJzKCk7XG4gIH0sXG5cbiAgZGlzY29ubmVjdDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5ub2Rlc18uZm9yRWFjaChmdW5jdGlvbihub2RlKSB7XG4gICAgICB2YXIgcmVnaXN0cmF0aW9ucyA9IHJlZ2lzdHJhdGlvbnNUYWJsZS5nZXQobm9kZSk7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJlZ2lzdHJhdGlvbnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIHJlZ2lzdHJhdGlvbiA9IHJlZ2lzdHJhdGlvbnNbaV07XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb24ub2JzZXJ2ZXIgPT09IHRoaXMpIHtcbiAgICAgICAgICByZWdpc3RyYXRpb24ucmVtb3ZlTGlzdGVuZXJzKCk7XG4gICAgICAgICAgcmVnaXN0cmF0aW9ucy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgLy8gRWFjaCBub2RlIGNhbiBvbmx5IGhhdmUgb25lIHJlZ2lzdGVyZWQgb2JzZXJ2ZXIgYXNzb2NpYXRlZCB3aXRoXG4gICAgICAgICAgLy8gdGhpcyBvYnNlcnZlci5cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sIHRoaXMpO1xuICAgIHRoaXMucmVjb3Jkc18gPSBbXTtcbiAgfSxcblxuICB0YWtlUmVjb3JkczogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGNvcHlPZlJlY29yZHMgPSB0aGlzLnJlY29yZHNfO1xuICAgIHRoaXMucmVjb3Jkc18gPSBbXTtcbiAgICByZXR1cm4gY29weU9mUmVjb3JkcztcbiAgfVxufTtcblxuLyoqXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZVxuICogQHBhcmFtIHtOb2RlfSB0YXJnZXRcbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBNdXRhdGlvblJlY29yZCh0eXBlLCB0YXJnZXQpIHtcbiAgdGhpcy50eXBlID0gdHlwZTtcbiAgdGhpcy50YXJnZXQgPSB0YXJnZXQ7XG4gIHRoaXMuYWRkZWROb2RlcyA9IFtdO1xuICB0aGlzLnJlbW92ZWROb2RlcyA9IFtdO1xuICB0aGlzLnByZXZpb3VzU2libGluZyA9IG51bGw7XG4gIHRoaXMubmV4dFNpYmxpbmcgPSBudWxsO1xuICB0aGlzLmF0dHJpYnV0ZU5hbWUgPSBudWxsO1xuICB0aGlzLmF0dHJpYnV0ZU5hbWVzcGFjZSA9IG51bGw7XG4gIHRoaXMub2xkVmFsdWUgPSBudWxsO1xufVxuXG5mdW5jdGlvbiBjb3B5TXV0YXRpb25SZWNvcmQob3JpZ2luYWwpIHtcbiAgdmFyIHJlY29yZCA9IG5ldyBNdXRhdGlvblJlY29yZChvcmlnaW5hbC50eXBlLCBvcmlnaW5hbC50YXJnZXQpO1xuICByZWNvcmQuYWRkZWROb2RlcyA9IG9yaWdpbmFsLmFkZGVkTm9kZXMuc2xpY2UoKTtcbiAgcmVjb3JkLnJlbW92ZWROb2RlcyA9IG9yaWdpbmFsLnJlbW92ZWROb2Rlcy5zbGljZSgpO1xuICByZWNvcmQucHJldmlvdXNTaWJsaW5nID0gb3JpZ2luYWwucHJldmlvdXNTaWJsaW5nO1xuICByZWNvcmQubmV4dFNpYmxpbmcgPSBvcmlnaW5hbC5uZXh0U2libGluZztcbiAgcmVjb3JkLmF0dHJpYnV0ZU5hbWUgPSBvcmlnaW5hbC5hdHRyaWJ1dGVOYW1lO1xuICByZWNvcmQuYXR0cmlidXRlTmFtZXNwYWNlID0gb3JpZ2luYWwuYXR0cmlidXRlTmFtZXNwYWNlO1xuICByZWNvcmQub2xkVmFsdWUgPSBvcmlnaW5hbC5vbGRWYWx1ZTtcbiAgcmV0dXJuIHJlY29yZDtcbn07XG5cbi8vIFdlIGtlZXAgdHJhY2sgb2YgdGhlIHR3byAocG9zc2libHkgb25lKSByZWNvcmRzIHVzZWQgaW4gYSBzaW5nbGUgbXV0YXRpb24uXG52YXIgY3VycmVudFJlY29yZCwgcmVjb3JkV2l0aE9sZFZhbHVlO1xuXG4vKipcbiAqIENyZWF0ZXMgYSByZWNvcmQgd2l0aG91dCB8b2xkVmFsdWV8IGFuZCBjYWNoZXMgaXQgYXMgfGN1cnJlbnRSZWNvcmR8IGZvclxuICogbGF0ZXIgdXNlLlxuICogQHBhcmFtIHtzdHJpbmd9IG9sZFZhbHVlXG4gKiBAcmV0dXJuIHtNdXRhdGlvblJlY29yZH1cbiAqL1xuZnVuY3Rpb24gZ2V0UmVjb3JkKHR5cGUsIHRhcmdldCkge1xuICByZXR1cm4gY3VycmVudFJlY29yZCA9IG5ldyBNdXRhdGlvblJlY29yZCh0eXBlLCB0YXJnZXQpO1xufVxuXG4vKipcbiAqIEdldHMgb3IgY3JlYXRlcyBhIHJlY29yZCB3aXRoIHxvbGRWYWx1ZXwgYmFzZWQgaW4gdGhlIHxjdXJyZW50UmVjb3JkfFxuICogQHBhcmFtIHtzdHJpbmd9IG9sZFZhbHVlXG4gKiBAcmV0dXJuIHtNdXRhdGlvblJlY29yZH1cbiAqL1xuZnVuY3Rpb24gZ2V0UmVjb3JkV2l0aE9sZFZhbHVlKG9sZFZhbHVlKSB7XG4gIGlmIChyZWNvcmRXaXRoT2xkVmFsdWUpXG4gICAgcmV0dXJuIHJlY29yZFdpdGhPbGRWYWx1ZTtcbiAgcmVjb3JkV2l0aE9sZFZhbHVlID0gY29weU11dGF0aW9uUmVjb3JkKGN1cnJlbnRSZWNvcmQpO1xuICByZWNvcmRXaXRoT2xkVmFsdWUub2xkVmFsdWUgPSBvbGRWYWx1ZTtcbiAgcmV0dXJuIHJlY29yZFdpdGhPbGRWYWx1ZTtcbn1cblxuZnVuY3Rpb24gY2xlYXJSZWNvcmRzKCkge1xuICBjdXJyZW50UmVjb3JkID0gcmVjb3JkV2l0aE9sZFZhbHVlID0gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEBwYXJhbSB7TXV0YXRpb25SZWNvcmR9IHJlY29yZFxuICogQHJldHVybiB7Ym9vbGVhbn0gV2hldGhlciB0aGUgcmVjb3JkIHJlcHJlc2VudHMgYSByZWNvcmQgZnJvbSB0aGUgY3VycmVudFxuICogbXV0YXRpb24gZXZlbnQuXG4gKi9cbmZ1bmN0aW9uIHJlY29yZFJlcHJlc2VudHNDdXJyZW50TXV0YXRpb24ocmVjb3JkKSB7XG4gIHJldHVybiByZWNvcmQgPT09IHJlY29yZFdpdGhPbGRWYWx1ZSB8fCByZWNvcmQgPT09IGN1cnJlbnRSZWNvcmQ7XG59XG5cbi8qKlxuICogU2VsZWN0cyB3aGljaCByZWNvcmQsIGlmIGFueSwgdG8gcmVwbGFjZSB0aGUgbGFzdCByZWNvcmQgaW4gdGhlIHF1ZXVlLlxuICogVGhpcyByZXR1cm5zIHxudWxsfCBpZiBubyByZWNvcmQgc2hvdWxkIGJlIHJlcGxhY2VkLlxuICpcbiAqIEBwYXJhbSB7TXV0YXRpb25SZWNvcmR9IGxhc3RSZWNvcmRcbiAqIEBwYXJhbSB7TXV0YXRpb25SZWNvcmR9IG5ld1JlY29yZFxuICogQHBhcmFtIHtNdXRhdGlvblJlY29yZH1cbiAqL1xuZnVuY3Rpb24gc2VsZWN0UmVjb3JkKGxhc3RSZWNvcmQsIG5ld1JlY29yZCkge1xuICBpZiAobGFzdFJlY29yZCA9PT0gbmV3UmVjb3JkKVxuICAgIHJldHVybiBsYXN0UmVjb3JkO1xuXG4gIC8vIENoZWNrIGlmIHRoZSB0aGUgcmVjb3JkIHdlIGFyZSBhZGRpbmcgcmVwcmVzZW50cyB0aGUgc2FtZSByZWNvcmQuIElmXG4gIC8vIHNvLCB3ZSBrZWVwIHRoZSBvbmUgd2l0aCB0aGUgb2xkVmFsdWUgaW4gaXQuXG4gIGlmIChyZWNvcmRXaXRoT2xkVmFsdWUgJiYgcmVjb3JkUmVwcmVzZW50c0N1cnJlbnRNdXRhdGlvbihsYXN0UmVjb3JkKSlcbiAgICByZXR1cm4gcmVjb3JkV2l0aE9sZFZhbHVlO1xuXG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIENsYXNzIHVzZWQgdG8gcmVwcmVzZW50IGEgcmVnaXN0ZXJlZCBvYnNlcnZlci5cbiAqIEBwYXJhbSB7TXV0YXRpb25PYnNlcnZlcn0gb2JzZXJ2ZXJcbiAqIEBwYXJhbSB7Tm9kZX0gdGFyZ2V0XG4gKiBAcGFyYW0ge011dGF0aW9uT2JzZXJ2ZXJJbml0fSBvcHRpb25zXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gUmVnaXN0cmF0aW9uKG9ic2VydmVyLCB0YXJnZXQsIG9wdGlvbnMpIHtcbiAgdGhpcy5vYnNlcnZlciA9IG9ic2VydmVyO1xuICB0aGlzLnRhcmdldCA9IHRhcmdldDtcbiAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgdGhpcy50cmFuc2llbnRPYnNlcnZlZE5vZGVzID0gW107XG59XG5cblJlZ2lzdHJhdGlvbi5wcm90b3R5cGUgPSB7XG4gIGVucXVldWU6IGZ1bmN0aW9uKHJlY29yZCkge1xuICAgIHZhciByZWNvcmRzID0gdGhpcy5vYnNlcnZlci5yZWNvcmRzXztcbiAgICB2YXIgbGVuZ3RoID0gcmVjb3Jkcy5sZW5ndGg7XG5cbiAgICAvLyBUaGVyZSBhcmUgY2FzZXMgd2hlcmUgd2UgcmVwbGFjZSB0aGUgbGFzdCByZWNvcmQgd2l0aCB0aGUgbmV3IHJlY29yZC5cbiAgICAvLyBGb3IgZXhhbXBsZSBpZiB0aGUgcmVjb3JkIHJlcHJlc2VudHMgdGhlIHNhbWUgbXV0YXRpb24gd2UgbmVlZCB0byB1c2VcbiAgICAvLyB0aGUgb25lIHdpdGggdGhlIG9sZFZhbHVlLiBJZiB3ZSBnZXQgc2FtZSByZWNvcmQgKHRoaXMgY2FuIGhhcHBlbiBhcyB3ZVxuICAgIC8vIHdhbGsgdXAgdGhlIHRyZWUpIHdlIGlnbm9yZSB0aGUgbmV3IHJlY29yZC5cbiAgICBpZiAocmVjb3Jkcy5sZW5ndGggPiAwKSB7XG4gICAgICB2YXIgbGFzdFJlY29yZCA9IHJlY29yZHNbbGVuZ3RoIC0gMV07XG4gICAgICB2YXIgcmVjb3JkVG9SZXBsYWNlTGFzdCA9IHNlbGVjdFJlY29yZChsYXN0UmVjb3JkLCByZWNvcmQpO1xuICAgICAgaWYgKHJlY29yZFRvUmVwbGFjZUxhc3QpIHtcbiAgICAgICAgcmVjb3Jkc1tsZW5ndGggLSAxXSA9IHJlY29yZFRvUmVwbGFjZUxhc3Q7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgc2NoZWR1bGVDYWxsYmFjayh0aGlzLm9ic2VydmVyKTtcbiAgICB9XG5cbiAgICByZWNvcmRzW2xlbmd0aF0gPSByZWNvcmQ7XG4gIH0sXG5cbiAgYWRkTGlzdGVuZXJzOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmFkZExpc3RlbmVyc18odGhpcy50YXJnZXQpO1xuICB9LFxuXG4gIGFkZExpc3RlbmVyc186IGZ1bmN0aW9uKG5vZGUpIHtcbiAgICB2YXIgb3B0aW9ucyA9IHRoaXMub3B0aW9ucztcbiAgICBpZiAob3B0aW9ucy5hdHRyaWJ1dGVzKVxuICAgICAgbm9kZS5hZGRFdmVudExpc3RlbmVyKCdET01BdHRyTW9kaWZpZWQnLCB0aGlzLCB0cnVlKTtcblxuICAgIGlmIChvcHRpb25zLmNoYXJhY3RlckRhdGEpXG4gICAgICBub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ0RPTUNoYXJhY3RlckRhdGFNb2RpZmllZCcsIHRoaXMsIHRydWUpO1xuXG4gICAgaWYgKG9wdGlvbnMuY2hpbGRMaXN0KVxuICAgICAgbm9kZS5hZGRFdmVudExpc3RlbmVyKCdET01Ob2RlSW5zZXJ0ZWQnLCB0aGlzLCB0cnVlKTtcblxuICAgIGlmIChvcHRpb25zLmNoaWxkTGlzdCB8fCBvcHRpb25zLnN1YnRyZWUpXG4gICAgICBub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ0RPTU5vZGVSZW1vdmVkJywgdGhpcywgdHJ1ZSk7XG4gIH0sXG5cbiAgcmVtb3ZlTGlzdGVuZXJzOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyc18odGhpcy50YXJnZXQpO1xuICB9LFxuXG4gIHJlbW92ZUxpc3RlbmVyc186IGZ1bmN0aW9uKG5vZGUpIHtcbiAgICB2YXIgb3B0aW9ucyA9IHRoaXMub3B0aW9ucztcbiAgICBpZiAob3B0aW9ucy5hdHRyaWJ1dGVzKVxuICAgICAgbm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdET01BdHRyTW9kaWZpZWQnLCB0aGlzLCB0cnVlKTtcblxuICAgIGlmIChvcHRpb25zLmNoYXJhY3RlckRhdGEpXG4gICAgICBub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ0RPTUNoYXJhY3RlckRhdGFNb2RpZmllZCcsIHRoaXMsIHRydWUpO1xuXG4gICAgaWYgKG9wdGlvbnMuY2hpbGRMaXN0KVxuICAgICAgbm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdET01Ob2RlSW5zZXJ0ZWQnLCB0aGlzLCB0cnVlKTtcblxuICAgIGlmIChvcHRpb25zLmNoaWxkTGlzdCB8fCBvcHRpb25zLnN1YnRyZWUpXG4gICAgICBub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ0RPTU5vZGVSZW1vdmVkJywgdGhpcywgdHJ1ZSk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEFkZHMgYSB0cmFuc2llbnQgb2JzZXJ2ZXIgb24gbm9kZS4gVGhlIHRyYW5zaWVudCBvYnNlcnZlciBnZXRzIHJlbW92ZWRcbiAgICogbmV4dCB0aW1lIHdlIGRlbGl2ZXIgdGhlIGNoYW5nZSByZWNvcmRzLlxuICAgKiBAcGFyYW0ge05vZGV9IG5vZGVcbiAgICovXG4gIGFkZFRyYW5zaWVudE9ic2VydmVyOiBmdW5jdGlvbihub2RlKSB7XG4gICAgLy8gRG9uJ3QgYWRkIHRyYW5zaWVudCBvYnNlcnZlcnMgb24gdGhlIHRhcmdldCBpdHNlbGYuIFdlIGFscmVhZHkgaGF2ZSBhbGxcbiAgICAvLyB0aGUgcmVxdWlyZWQgbGlzdGVuZXJzIHNldCB1cCBvbiB0aGUgdGFyZ2V0LlxuICAgIGlmIChub2RlID09PSB0aGlzLnRhcmdldClcbiAgICAgIHJldHVybjtcblxuICAgIHRoaXMuYWRkTGlzdGVuZXJzXyhub2RlKTtcbiAgICB0aGlzLnRyYW5zaWVudE9ic2VydmVkTm9kZXMucHVzaChub2RlKTtcbiAgICB2YXIgcmVnaXN0cmF0aW9ucyA9IHJlZ2lzdHJhdGlvbnNUYWJsZS5nZXQobm9kZSk7XG4gICAgaWYgKCFyZWdpc3RyYXRpb25zKVxuICAgICAgcmVnaXN0cmF0aW9uc1RhYmxlLnNldChub2RlLCByZWdpc3RyYXRpb25zID0gW10pO1xuXG4gICAgLy8gV2Uga25vdyB0aGF0IHJlZ2lzdHJhdGlvbnMgZG9lcyBub3QgY29udGFpbiB0aGlzIGJlY2F1c2Ugd2UgYWxyZWFkeVxuICAgIC8vIGNoZWNrZWQgaWYgbm9kZSA9PT0gdGhpcy50YXJnZXQuXG4gICAgcmVnaXN0cmF0aW9ucy5wdXNoKHRoaXMpO1xuICB9LFxuXG4gIHJlbW92ZVRyYW5zaWVudE9ic2VydmVyczogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHRyYW5zaWVudE9ic2VydmVkTm9kZXMgPSB0aGlzLnRyYW5zaWVudE9ic2VydmVkTm9kZXM7XG4gICAgdGhpcy50cmFuc2llbnRPYnNlcnZlZE5vZGVzID0gW107XG5cbiAgICB0cmFuc2llbnRPYnNlcnZlZE5vZGVzLmZvckVhY2goZnVuY3Rpb24obm9kZSkge1xuICAgICAgLy8gVHJhbnNpZW50IG9ic2VydmVycyBhcmUgbmV2ZXIgYWRkZWQgdG8gdGhlIHRhcmdldC5cbiAgICAgIHRoaXMucmVtb3ZlTGlzdGVuZXJzXyhub2RlKTtcblxuICAgICAgdmFyIHJlZ2lzdHJhdGlvbnMgPSByZWdpc3RyYXRpb25zVGFibGUuZ2V0KG5vZGUpO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZWdpc3RyYXRpb25zLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb25zW2ldID09PSB0aGlzKSB7XG4gICAgICAgICAgcmVnaXN0cmF0aW9ucy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgLy8gRWFjaCBub2RlIGNhbiBvbmx5IGhhdmUgb25lIHJlZ2lzdGVyZWQgb2JzZXJ2ZXIgYXNzb2NpYXRlZCB3aXRoXG4gICAgICAgICAgLy8gdGhpcyBvYnNlcnZlci5cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sIHRoaXMpO1xuICB9LFxuXG4gIGhhbmRsZUV2ZW50OiBmdW5jdGlvbihlKSB7XG4gICAgLy8gU3RvcCBwcm9wYWdhdGlvbiBzaW5jZSB3ZSBhcmUgbWFuYWdpbmcgdGhlIHByb3BhZ2F0aW9uIG1hbnVhbGx5LlxuICAgIC8vIFRoaXMgbWVhbnMgdGhhdCBvdGhlciBtdXRhdGlvbiBldmVudHMgb24gdGhlIHBhZ2Ugd2lsbCBub3Qgd29ya1xuICAgIC8vIGNvcnJlY3RseSBidXQgdGhhdCBpcyBieSBkZXNpZ24uXG4gICAgZS5zdG9wSW1tZWRpYXRlUHJvcGFnYXRpb24oKTtcblxuICAgIHN3aXRjaCAoZS50eXBlKSB7XG4gICAgICBjYXNlICdET01BdHRyTW9kaWZpZWQnOlxuICAgICAgICAvLyBodHRwOi8vZG9tLnNwZWMud2hhdHdnLm9yZy8jY29uY2VwdC1tby1xdWV1ZS1hdHRyaWJ1dGVzXG5cbiAgICAgICAgdmFyIG5hbWUgPSBlLmF0dHJOYW1lO1xuICAgICAgICB2YXIgbmFtZXNwYWNlID0gZS5yZWxhdGVkTm9kZS5uYW1lc3BhY2VVUkk7XG4gICAgICAgIHZhciB0YXJnZXQgPSBlLnRhcmdldDtcblxuICAgICAgICAvLyAxLlxuICAgICAgICB2YXIgcmVjb3JkID0gbmV3IGdldFJlY29yZCgnYXR0cmlidXRlcycsIHRhcmdldCk7XG4gICAgICAgIHJlY29yZC5hdHRyaWJ1dGVOYW1lID0gbmFtZTtcbiAgICAgICAgcmVjb3JkLmF0dHJpYnV0ZU5hbWVzcGFjZSA9IG5hbWVzcGFjZTtcblxuICAgICAgICAvLyAyLlxuICAgICAgICB2YXIgb2xkVmFsdWUgPVxuICAgICAgICAgICAgZS5hdHRyQ2hhbmdlID09PSBNdXRhdGlvbkV2ZW50LkFERElUSU9OID8gbnVsbCA6IGUucHJldlZhbHVlO1xuXG4gICAgICAgIGZvckVhY2hBbmNlc3RvckFuZE9ic2VydmVyRW5xdWV1ZVJlY29yZCh0YXJnZXQsIGZ1bmN0aW9uKG9wdGlvbnMpIHtcbiAgICAgICAgICAvLyAzLjEsIDQuMlxuICAgICAgICAgIGlmICghb3B0aW9ucy5hdHRyaWJ1dGVzKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgICAgLy8gMy4yLCA0LjNcbiAgICAgICAgICBpZiAob3B0aW9ucy5hdHRyaWJ1dGVGaWx0ZXIgJiYgb3B0aW9ucy5hdHRyaWJ1dGVGaWx0ZXIubGVuZ3RoICYmXG4gICAgICAgICAgICAgIG9wdGlvbnMuYXR0cmlidXRlRmlsdGVyLmluZGV4T2YobmFtZSkgPT09IC0xICYmXG4gICAgICAgICAgICAgIG9wdGlvbnMuYXR0cmlidXRlRmlsdGVyLmluZGV4T2YobmFtZXNwYWNlKSA9PT0gLTEpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gMy4zLCA0LjRcbiAgICAgICAgICBpZiAob3B0aW9ucy5hdHRyaWJ1dGVPbGRWYWx1ZSlcbiAgICAgICAgICAgIHJldHVybiBnZXRSZWNvcmRXaXRoT2xkVmFsdWUob2xkVmFsdWUpO1xuXG4gICAgICAgICAgLy8gMy40LCA0LjVcbiAgICAgICAgICByZXR1cm4gcmVjb3JkO1xuICAgICAgICB9KTtcblxuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSAnRE9NQ2hhcmFjdGVyRGF0YU1vZGlmaWVkJzpcbiAgICAgICAgLy8gaHR0cDovL2RvbS5zcGVjLndoYXR3Zy5vcmcvI2NvbmNlcHQtbW8tcXVldWUtY2hhcmFjdGVyZGF0YVxuICAgICAgICB2YXIgdGFyZ2V0ID0gZS50YXJnZXQ7XG5cbiAgICAgICAgLy8gMS5cbiAgICAgICAgdmFyIHJlY29yZCA9IGdldFJlY29yZCgnY2hhcmFjdGVyRGF0YScsIHRhcmdldCk7XG5cbiAgICAgICAgLy8gMi5cbiAgICAgICAgdmFyIG9sZFZhbHVlID0gZS5wcmV2VmFsdWU7XG5cblxuICAgICAgICBmb3JFYWNoQW5jZXN0b3JBbmRPYnNlcnZlckVucXVldWVSZWNvcmQodGFyZ2V0LCBmdW5jdGlvbihvcHRpb25zKSB7XG4gICAgICAgICAgLy8gMy4xLCA0LjJcbiAgICAgICAgICBpZiAoIW9wdGlvbnMuY2hhcmFjdGVyRGF0YSlcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICAgIC8vIDMuMiwgNC4zXG4gICAgICAgICAgaWYgKG9wdGlvbnMuY2hhcmFjdGVyRGF0YU9sZFZhbHVlKVxuICAgICAgICAgICAgcmV0dXJuIGdldFJlY29yZFdpdGhPbGRWYWx1ZShvbGRWYWx1ZSk7XG5cbiAgICAgICAgICAvLyAzLjMsIDQuNFxuICAgICAgICAgIHJldHVybiByZWNvcmQ7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlICdET01Ob2RlUmVtb3ZlZCc6XG4gICAgICAgIHRoaXMuYWRkVHJhbnNpZW50T2JzZXJ2ZXIoZS50YXJnZXQpO1xuICAgICAgICAvLyBGYWxsIHRocm91Z2guXG4gICAgICBjYXNlICdET01Ob2RlSW5zZXJ0ZWQnOlxuICAgICAgICAvLyBodHRwOi8vZG9tLnNwZWMud2hhdHdnLm9yZy8jY29uY2VwdC1tby1xdWV1ZS1jaGlsZGxpc3RcbiAgICAgICAgdmFyIHRhcmdldCA9IGUucmVsYXRlZE5vZGU7XG4gICAgICAgIHZhciBjaGFuZ2VkTm9kZSA9IGUudGFyZ2V0O1xuICAgICAgICB2YXIgYWRkZWROb2RlcywgcmVtb3ZlZE5vZGVzO1xuICAgICAgICBpZiAoZS50eXBlID09PSAnRE9NTm9kZUluc2VydGVkJykge1xuICAgICAgICAgIGFkZGVkTm9kZXMgPSBbY2hhbmdlZE5vZGVdO1xuICAgICAgICAgIHJlbW92ZWROb2RlcyA9IFtdO1xuICAgICAgICB9IGVsc2Uge1xuXG4gICAgICAgICAgYWRkZWROb2RlcyA9IFtdO1xuICAgICAgICAgIHJlbW92ZWROb2RlcyA9IFtjaGFuZ2VkTm9kZV07XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHByZXZpb3VzU2libGluZyA9IGNoYW5nZWROb2RlLnByZXZpb3VzU2libGluZztcbiAgICAgICAgdmFyIG5leHRTaWJsaW5nID0gY2hhbmdlZE5vZGUubmV4dFNpYmxpbmc7XG5cbiAgICAgICAgLy8gMS5cbiAgICAgICAgdmFyIHJlY29yZCA9IGdldFJlY29yZCgnY2hpbGRMaXN0JywgdGFyZ2V0KTtcbiAgICAgICAgcmVjb3JkLmFkZGVkTm9kZXMgPSBhZGRlZE5vZGVzO1xuICAgICAgICByZWNvcmQucmVtb3ZlZE5vZGVzID0gcmVtb3ZlZE5vZGVzO1xuICAgICAgICByZWNvcmQucHJldmlvdXNTaWJsaW5nID0gcHJldmlvdXNTaWJsaW5nO1xuICAgICAgICByZWNvcmQubmV4dFNpYmxpbmcgPSBuZXh0U2libGluZztcblxuICAgICAgICBmb3JFYWNoQW5jZXN0b3JBbmRPYnNlcnZlckVucXVldWVSZWNvcmQodGFyZ2V0LCBmdW5jdGlvbihvcHRpb25zKSB7XG4gICAgICAgICAgLy8gMi4xLCAzLjJcbiAgICAgICAgICBpZiAoIW9wdGlvbnMuY2hpbGRMaXN0KVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgICAgLy8gMi4yLCAzLjNcbiAgICAgICAgICByZXR1cm4gcmVjb3JkO1xuICAgICAgICB9KTtcblxuICAgIH1cblxuICAgIGNsZWFyUmVjb3JkcygpO1xuICB9XG59O1xuXG5pZiAoIU11dGF0aW9uT2JzZXJ2ZXIpIHtcbiAgTXV0YXRpb25PYnNlcnZlciA9IEpzTXV0YXRpb25PYnNlcnZlcjtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBNdXRhdGlvbk9ic2VydmVyO1xuIiwiaW1wb3J0IHsgU2NvcGUsIEVsZW1lbnRNYXRjaGVyLCBFdmVudE1hdGNoZXIsIFNjb3BlRXhlY3V0b3IsIFN1YnNjcmlwdGlvbkV4ZWN1dG9yIH0gZnJvbSAnLi9zY29wZSc7XG5cbmV4cG9ydCBkZWZhdWx0IERlY2w7XG5cbmV4cG9ydCB7IFNjb3BlLCBFbGVtZW50TWF0Y2hlciwgRXZlbnRNYXRjaGVyLCBTY29wZUV4ZWN1dG9yLCBTdWJzY3JpcHRpb25FeGVjdXRvciB9O1xuXG5leHBvcnQgY2xhc3MgRGVjbCB7XG4gICAgcHJpdmF0ZSBzdGF0aWMgZGVmYXVsdEluc3RhbmNlOiBEZWNsIHwgbnVsbCA9IG51bGw7XG5cbiAgICBzdGF0aWMgc2VsZWN0KG1hdGNoZXI6IEVsZW1lbnRNYXRjaGVyLCBleGVjdXRvcjogU2NvcGVFeGVjdXRvcik6IFNjb3BlIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0RGVmYXVsdEluc3RhbmNlKCkuc2VsZWN0KG1hdGNoZXIsIGV4ZWN1dG9yKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgb24obWF0Y2hlcjogRXZlbnRNYXRjaGVyLCBleGVjdXRvcjogU3Vic2NyaXB0aW9uRXhlY3V0b3IpOiBTY29wZSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldERlZmF1bHRJbnN0YW5jZSgpLm9uKG1hdGNoZXIsIGV4ZWN1dG9yKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgZ2V0Um9vdFNjb3BlKCk6IFNjb3BlIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0RGVmYXVsdEluc3RhbmNlKCkuZ2V0Um9vdFNjb3BlKCk7XG4gICAgfVxuXG4gICAgc3RhdGljIGluc3BlY3QoKTogdm9pZCB7XG4gICAgICAgIHRoaXMuZ2V0RGVmYXVsdEluc3RhbmNlKCkuaW5zcGVjdCgpO1xuICAgIH1cblxuICAgIHN0YXRpYyBnZXREZWZhdWx0SW5zdGFuY2UoKSA6IERlY2wge1xuICAgICAgICByZXR1cm4gdGhpcy5kZWZhdWx0SW5zdGFuY2UgfHwgKHRoaXMuZGVmYXVsdEluc3RhbmNlID0gbmV3IERlY2woZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50KSk7XG4gICAgfVxuXG4gICAgc3RhdGljIHNldERlZmF1bHRJbnN0YW5jZShkZWNsOiBEZWNsKSA6IERlY2wge1xuICAgICAgICByZXR1cm4gdGhpcy5kZWZhdWx0SW5zdGFuY2UgPSBkZWNsO1xuICAgIH1cblxuICAgIHN0YXRpYyBwcmlzdGluZSgpOiB2b2lkIHtcbiAgICAgICAgaWYodGhpcy5kZWZhdWx0SW5zdGFuY2UpIHtcbiAgICAgICAgICAgIHRoaXMuZGVmYXVsdEluc3RhbmNlLnByaXN0aW5lKCk7XG4gICAgICAgICAgICB0aGlzLmRlZmF1bHRJbnN0YW5jZSA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIHNjb3BlOiBTY29wZTtcblxuICAgIGNvbnN0cnVjdG9yKHJvb3Q6IEVsZW1lbnQpIHtcbiAgICAgICAgdGhpcy5zY29wZSA9IFNjb3BlLmJ1aWxkUm9vdFNjb3BlKHJvb3QpO1xuICAgIH1cblxuICAgIHNlbGVjdChtYXRjaGVyOiBFbGVtZW50TWF0Y2hlciwgZXhlY3V0b3I6IFNjb3BlRXhlY3V0b3IpOiBTY29wZSB7XG4gICAgICAgIHJldHVybiB0aGlzLnNjb3BlLnNlbGVjdChtYXRjaGVyLCBleGVjdXRvcik7XG4gICAgfVxuXG4gICAgb24obWF0Y2hlcjogRXZlbnRNYXRjaGVyLCBleGVjdXRvcjogU3Vic2NyaXB0aW9uRXhlY3V0b3IpOiBTY29wZSB7XG4gICAgICAgIHJldHVybiB0aGlzLnNjb3BlLm9uKG1hdGNoZXIsIGV4ZWN1dG9yKTtcbiAgICB9XG5cbiAgICBnZXRSb290U2NvcGUoKTogU2NvcGUge1xuICAgICAgIHJldHVybiB0aGlzLnNjb3BlOyBcbiAgICB9XG5cbiAgICBpbnNwZWN0KCk6IHZvaWQge1xuICAgICAgICB0aGlzLnNjb3BlLmluc3BlY3QoKTtcbiAgICB9XG5cbiAgICBwcmlzdGluZSgpOiB2b2lkIHtcbiAgICAgICAgdGhpcy5zY29wZS5wcmlzdGluZSgpO1xuICAgIH1cbn1cblxuLy8gRXhwb3J0IHRvIGEgZ2xvYmFsIGZvciB0aGUgYnJvd3NlciAodGhlcmUgKmhhcyogdG8gYmUgYSBiZXR0ZXIgd2F5IHRvIGRvIHRoaXMhKVxuaWYodHlwZW9mKHdpbmRvdykgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgKDxhbnk+d2luZG93KS5EZWNsID0gRGVjbDtcbn1cbiIsImltcG9ydCB7IFN1YnNjcmlwdGlvbiwgU3Vic2NyaXB0aW9uRXhlY3V0b3IgfSBmcm9tICcuLi9zdWJzY3JpcHRpb25zL3N1YnNjcmlwdGlvbic7XG5cbmV4cG9ydCB7IFN1YnNjcmlwdGlvbkV4ZWN1dG9yIH07XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBEZWNsYXJhdGlvbiB7XG4gICAgcHJvdGVjdGVkIGlzQWN0aXZhdGVkOiBib29sZWFuID0gZmFsc2U7XG4gICAgcHJvdGVjdGVkIHJlYWRvbmx5IGVsZW1lbnQ6IEVsZW1lbnQ7XG4gICAgcHJvdGVjdGVkIHJlYWRvbmx5IHN1YnNjcmlwdGlvbjogU3Vic2NyaXB0aW9uO1xuXG4gICAgY29uc3RydWN0b3IoZWxlbWVudDogRWxlbWVudCkge1xuICAgICAgICB0aGlzLmVsZW1lbnQgPSBlbGVtZW50O1xuICAgIH1cblxuICAgIGFjdGl2YXRlKCk6IHZvaWQge1xuICAgICAgICBpZighdGhpcy5pc0FjdGl2YXRlZCkge1xuICAgICAgICAgICAgdGhpcy5pc0FjdGl2YXRlZCA9IHRydWU7XG5cbiAgICAgICAgICAgIHRoaXMuc3Vic2NyaXB0aW9uLmNvbm5lY3QoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGRlYWN0aXZhdGUoKTogdm9pZCB7XG4gICAgICAgIGlmKHRoaXMuaXNBY3RpdmF0ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuaXNBY3RpdmF0ZWQgPSBmYWxzZTtcblxuICAgICAgICAgICAgdGhpcy5zdWJzY3JpcHRpb24uZGlzY29ubmVjdCgpO1xuICAgICAgICB9ICAgICAgICBcbiAgICB9XG5cbiAgICBhYnN0cmFjdCBpbnNwZWN0KCk6IHZvaWQ7XG59IiwiaW1wb3J0IHsgRGVjbGFyYXRpb24sIFN1YnNjcmlwdGlvbkV4ZWN1dG9yIH0gZnJvbSAnLi9kZWNsYXJhdGlvbic7XG5pbXBvcnQgeyBUcml2aWFsU3Vic2NyaXB0aW9uIH0gZnJvbSAnLi4vc3Vic2NyaXB0aW9ucy90cml2aWFsX3N1YnNjcmlwdGlvbic7XG5cbmV4cG9ydCB7IFN1YnNjcmlwdGlvbkV4ZWN1dG9yIH07XG5cbmV4cG9ydCBjbGFzcyBNYXRjaERlY2xhcmF0aW9uIGV4dGVuZHMgRGVjbGFyYXRpb24ge1xuICAgIHByb3RlY3RlZCByZWFkb25seSBzdWJzY3JpcHRpb246IFRyaXZpYWxTdWJzY3JpcHRpb247XG4gICAgcHJvdGVjdGVkIHJlYWRvbmx5IGV4ZWN1dG9yOiBTdWJzY3JpcHRpb25FeGVjdXRvcjtcblxuICAgIGNvbnN0cnVjdG9yKGVsZW1lbnQ6IEVsZW1lbnQsIGV4ZWN1dG9yOiBTdWJzY3JpcHRpb25FeGVjdXRvcikge1xuICAgICAgICBzdXBlcihlbGVtZW50KTtcblxuICAgICAgICB0aGlzLmV4ZWN1dG9yID0gZXhlY3V0b3I7XG5cbiAgICAgICAgdGhpcy5zdWJzY3JpcHRpb24gPSBuZXcgVHJpdmlhbFN1YnNjcmlwdGlvbih0aGlzLmVsZW1lbnQsIHsgY29ubmVjdGVkOiB0cnVlIH0sIHRoaXMuZXhlY3V0b3IpO1xuICAgIH1cblxuICAgIGluc3BlY3QoKTogdm9pZCB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdmaXJlcycsIHRoaXMuZXhlY3V0b3IsICd3aGVuIHRoZSBlbGVtZW50IGVudGVycyB0aGUgRE9NIChtYXRjaGVzKScpO1xuICAgIH1cbn0iLCJpbXBvcnQgeyBEZWNsYXJhdGlvbiwgU3Vic2NyaXB0aW9uRXhlY3V0b3IgfSBmcm9tICcuL2RlY2xhcmF0aW9uJztcbmltcG9ydCB7IEV2ZW50U3Vic2NyaXB0aW9uLCBFdmVudE1hdGNoZXIgfSBmcm9tICcuLi9zdWJzY3JpcHRpb25zL2V2ZW50X3N1YnNjcmlwdGlvbic7XG5cbmV4cG9ydCB7IEV2ZW50TWF0Y2hlciwgU3Vic2NyaXB0aW9uRXhlY3V0b3IgfTtcblxuZXhwb3J0IGNsYXNzIE9uRGVjbGFyYXRpb24gZXh0ZW5kcyBEZWNsYXJhdGlvbiB7XG4gICAgcHJvdGVjdGVkIHN1YnNjcmlwdGlvbjogRXZlbnRTdWJzY3JpcHRpb247XG4gICAgcHJvdGVjdGVkIG1hdGNoZXI6IEV2ZW50TWF0Y2hlcjtcbiAgICBwcm90ZWN0ZWQgZXhlY3V0b3I6IFN1YnNjcmlwdGlvbkV4ZWN1dG9yO1xuXG4gICAgY29uc3RydWN0b3IoZWxlbWVudDogRWxlbWVudCwgbWF0Y2hlcjogRXZlbnRNYXRjaGVyLCBleGVjdXRvcjogU3Vic2NyaXB0aW9uRXhlY3V0b3IpIHtcbiAgICAgICAgc3VwZXIoZWxlbWVudCk7XG5cbiAgICAgICAgdGhpcy5tYXRjaGVyID0gbWF0Y2hlcjtcbiAgICAgICAgdGhpcy5leGVjdXRvciA9IGV4ZWN1dG9yO1xuXG4gICAgICAgIHRoaXMuc3Vic2NyaXB0aW9uID0gbmV3IEV2ZW50U3Vic2NyaXB0aW9uKHRoaXMuZWxlbWVudCwgdGhpcy5tYXRjaGVyLCB0aGlzLmV4ZWN1dG9yKTsgICAgXG4gICAgfVxuXG4gICAgaW5zcGVjdCgpOiB2b2lkIHtcbiAgICAgICAgY29uc29sZS5sb2coJ2ZpcmVzJywgdGhpcy5leGVjdXRvciwgJ29uJywgdGhpcy5tYXRjaGVyKTtcbiAgICB9XG59IiwiaW1wb3J0IHsgRGVjbGFyYXRpb24gfSBmcm9tICcuL2RlY2xhcmF0aW9uJztcbmltcG9ydCB7IEVsZW1lbnRNYXRjaGVyIH0gZnJvbSAnLi4vZWxlbWVudF9jb2xsZWN0b3InO1xuaW1wb3J0IHsgU2NvcGUsIFNjb3BlRXhlY3V0b3IgfSBmcm9tICcuLi9zY29wZSc7XG5cbmV4cG9ydCB7IEVsZW1lbnRNYXRjaGVyLCBTY29wZUV4ZWN1dG9yIH07XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBTY29wZVRyYWNraW5nRGVjbGFyYXRpb24gZXh0ZW5kcyBEZWNsYXJhdGlvbiB7XG4gICAgcHJvdGVjdGVkIHJlYWRvbmx5IGNoaWxkU2NvcGVzOiBTY29wZVtdID0gW107XG4gICAgXG4gICAgZGVhY3RpdmF0ZSgpOiB2b2lkIHtcbiAgICAgICAgdGhpcy5yZW1vdmVBbGxDaGlsZFNjb3BlcygpO1xuICAgICAgICBzdXBlci5kZWFjdGl2YXRlKCk7XG4gICAgfVxuXG4gICAgZ2V0Q2hpbGRTY29wZXMoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmNoaWxkU2NvcGVzO1xuICAgIH1cblxuICAgIHByb3RlY3RlZCBhZGRDaGlsZFNjb3BlKHNjb3BlOiBTY29wZSkge1xuICAgICAgICBpZih0aGlzLmlzQWN0aXZhdGVkKSB7XG4gICAgICAgICAgICB0aGlzLmNoaWxkU2NvcGVzLnB1c2goc2NvcGUpO1xuXG4gICAgICAgICAgICBzY29wZS5hY3RpdmF0ZSgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJvdGVjdGVkIHJlbW92ZUNoaWxkU2NvcGUoc2NvcGU6IFNjb3BlKSB7IFxuICAgICAgICBzY29wZS5kZWFjdGl2YXRlKCk7XG5cbiAgICAgICAgaWYodGhpcy5pc0FjdGl2YXRlZCkge1xuICAgICAgICAgICAgbGV0IGluZGV4ID0gdGhpcy5jaGlsZFNjb3Blcy5pbmRleE9mKHNjb3BlKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYoaW5kZXggPj0gMCkge1xuICAgICAgICAgICAgICAgIHRoaXMuY2hpbGRTY29wZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByb3RlY3RlZCByZW1vdmVBbGxDaGlsZFNjb3BlcygpIHtcbiAgICAgICAgbGV0IGNoaWxkU2NvcGU6IFNjb3BlO1xuXG4gICAgICAgIHdoaWxlKGNoaWxkU2NvcGUgPSB0aGlzLmNoaWxkU2NvcGVzWzBdKSB7XG4gICAgICAgICAgICB0aGlzLnJlbW92ZUNoaWxkU2NvcGUoY2hpbGRTY29wZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgYWRkQ2hpbGRTY29wZUJ5RWxlbWVudChlbGVtZW50OiBFbGVtZW50LCBleGVjdXRvcj86IFNjb3BlRXhlY3V0b3IpIHtcbiAgICAgICAgbGV0IGNoaWxkU2NvcGUgPSBuZXcgU2NvcGUoZWxlbWVudCwgZXhlY3V0b3IpO1xuXG4gICAgICAgIHRoaXMuYWRkQ2hpbGRTY29wZShjaGlsZFNjb3BlKTtcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgcmVtb3ZlQ2hpbGRTY29wZUJ5RWxlbWVudChlbGVtZW50OiBFbGVtZW50KSB7XG4gICAgICAgIGZvcihsZXQgY2hpbGRTY29wZSBvZiB0aGlzLmNoaWxkU2NvcGVzKSB7XG4gICAgICAgICAgICBpZihjaGlsZFNjb3BlLmdldEVsZW1lbnQoKSA9PT0gZWxlbWVudCkge1xuICAgICAgICAgICAgICAgIHRoaXMucmVtb3ZlQ2hpbGRTY29wZShjaGlsZFNjb3BlKTtcbiAgICAgICAgICAgICAgICByZXR1cm47IC8vIGxvb3AgbXVzdCBleGlzdCB0byBhdm9pZCBkYXRhLXJhY2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn0iLCJpbXBvcnQgeyBTY29wZVRyYWNraW5nRGVjbGFyYXRpb24sIEVsZW1lbnRNYXRjaGVyLCBTY29wZUV4ZWN1dG9yIH0gZnJvbSAnLi9zY29wZV90cmFja2luZ19kZWNsYXJhdGlvbic7XG5pbXBvcnQgeyBNYXRjaGluZ0VsZW1lbnRzU3Vic2NyaXB0aW9uLCBNYXRjaGluZ0VsZW1lbnRzQ2hhbmdlZEV2ZW50IH0gZnJvbSAnLi4vc3Vic2NyaXB0aW9ucy9tYXRjaGluZ19lbGVtZW50c19zdWJzY3JpcHRpb24nO1xuXG5leHBvcnQgeyBFbGVtZW50TWF0Y2hlciwgU2NvcGVFeGVjdXRvciB9O1xuXG5leHBvcnQgY2xhc3MgU2VsZWN0RGVjbGFyYXRpb24gZXh0ZW5kcyBTY29wZVRyYWNraW5nRGVjbGFyYXRpb24ge1xuICAgIHByb3RlY3RlZCBzdWJzY3JpcHRpb246IE1hdGNoaW5nRWxlbWVudHNTdWJzY3JpcHRpb247XG4gICAgcHJvdGVjdGVkIG1hdGNoZXI6IEVsZW1lbnRNYXRjaGVyO1xuICAgIHByb3RlY3RlZCBleGVjdXRvcjogU2NvcGVFeGVjdXRvcjtcblxuICAgIGNvbnN0cnVjdG9yKGVsZW1lbnQ6IEVsZW1lbnQsIG1hdGNoZXI6IEVsZW1lbnRNYXRjaGVyLCBleGVjdXRvcjogU2NvcGVFeGVjdXRvcikge1xuICAgICAgICBzdXBlcihlbGVtZW50KTtcblxuICAgICAgICB0aGlzLm1hdGNoZXIgPSBtYXRjaGVyO1xuICAgICAgICB0aGlzLmV4ZWN1dG9yID0gZXhlY3V0b3I7XG5cbiAgICAgICAgdGhpcy5zdWJzY3JpcHRpb24gPSBuZXcgTWF0Y2hpbmdFbGVtZW50c1N1YnNjcmlwdGlvbih0aGlzLmVsZW1lbnQsIHRoaXMubWF0Y2hlciwgKGV2ZW50OiBNYXRjaGluZ0VsZW1lbnRzQ2hhbmdlZEV2ZW50KSA9PiB7XG4gICAgICAgICAgICBmb3IobGV0IGVsZW1lbnQgb2YgZXZlbnQuYWRkZWRFbGVtZW50cykge1xuICAgICAgICAgICAgICAgIHRoaXMuYWRkQ2hpbGRTY29wZUJ5RWxlbWVudChlbGVtZW50LCB0aGlzLmV4ZWN1dG9yKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9yKGxldCBlbGVtZW50IG9mIGV2ZW50LnJlbW92ZWRFbGVtZW50cykge1xuICAgICAgICAgICAgICAgIHRoaXMucmVtb3ZlQ2hpbGRTY29wZUJ5RWxlbWVudChlbGVtZW50KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgaW5zcGVjdCgpOiB2b2lkIHtcbiAgICAgICAgKDxhbnk+Y29uc29sZS5ncm91cCkodGhpcy5tYXRjaGVyLCAnKCcgKyB0aGlzLmNoaWxkU2NvcGVzLmxlbmd0aCArICcgbWF0Y2hlcyknKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgZm9yKGxldCBjaGlsZFNjb3BlIG9mIHRoaXMuY2hpbGRTY29wZXMpIHtcbiAgICAgICAgICAgICAgICBjaGlsZFNjb3BlLmluc3BlY3QoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfWZpbmFsbHl7XG4gICAgICAgICAgICBjb25zb2xlLmdyb3VwRW5kKCk7XG4gICAgICAgIH1cbiAgICB9XG59IiwiaW1wb3J0IHsgRGVjbGFyYXRpb24gfSBmcm9tICcuL2RlY2xhcmF0aW9uJztcbmltcG9ydCB7IFRyaXZpYWxTdWJzY3JpcHRpb24sIFN1YnNjcmlwdGlvbkV4ZWN1dG9yIH0gZnJvbSAnLi4vc3Vic2NyaXB0aW9ucy90cml2aWFsX3N1YnNjcmlwdGlvbic7XG5cbmV4cG9ydCB7IFN1YnNjcmlwdGlvbkV4ZWN1dG9yIH07XG5cbmV4cG9ydCBjbGFzcyBVbm1hdGNoRGVjbGFyYXRpb24gZXh0ZW5kcyBEZWNsYXJhdGlvbiB7XG4gICAgcHJvdGVjdGVkIHN1YnNjcmlwdGlvbjogVHJpdmlhbFN1YnNjcmlwdGlvbjtcbiAgICBwcm90ZWN0ZWQgZXhlY3V0b3I6IFN1YnNjcmlwdGlvbkV4ZWN1dG9yO1xuXG4gICAgY29uc3RydWN0b3IoZWxlbWVudDogRWxlbWVudCwgZXhlY3V0b3I6IFN1YnNjcmlwdGlvbkV4ZWN1dG9yKSB7XG4gICAgICAgIHN1cGVyKGVsZW1lbnQpO1xuXG4gICAgICAgIHRoaXMuZXhlY3V0b3IgPSBleGVjdXRvcjtcblxuICAgICAgICB0aGlzLnN1YnNjcmlwdGlvbiA9IG5ldyBUcml2aWFsU3Vic2NyaXB0aW9uKHRoaXMuZWxlbWVudCwgeyBkaXNjb25uZWN0ZWQ6IHRydWUgfSwgdGhpcy5leGVjdXRvcik7XG4gICAgfVxuXG4gICAgaW5zcGVjdCgpOiB2b2lkIHtcbiAgICAgICAgY29uc29sZS5sb2coJ2ZpcmVzJywgdGhpcy5leGVjdXRvciwgJ3doZW4gdGhlIGVsZW1lbnQgbGVhdmVzIHRoZSBET00gKHVubWF0Y2hlcyknKTtcbiAgICB9XG59IiwiaW1wb3J0IHsgU2NvcGVUcmFja2luZ0RlY2xhcmF0aW9uLCBFbGVtZW50TWF0Y2hlciwgU2NvcGVFeGVjdXRvciB9IGZyb20gJy4vc2NvcGVfdHJhY2tpbmdfZGVjbGFyYXRpb24nO1xuaW1wb3J0IHsgRWxlbWVudE1hdGNoZXNTdWJzY3JpcHRpb24sIEVsZW1lbnRNYXRjaGVzQ2hhbmdlZEV2ZW50IH0gZnJvbSAnLi4vc3Vic2NyaXB0aW9ucy9lbGVtZW50X21hdGNoZXNfc3Vic2NyaXB0aW9uJztcblxuZXhwb3J0IHsgRWxlbWVudE1hdGNoZXIsIFNjb3BlRXhlY3V0b3IgfTtcblxuZXhwb3J0IGNsYXNzIFdoZW5EZWNsYXJhdGlvbiBleHRlbmRzIFNjb3BlVHJhY2tpbmdEZWNsYXJhdGlvbiB7XG4gICAgcHJvdGVjdGVkIHN1YnNjcmlwdGlvbjogRWxlbWVudE1hdGNoZXNTdWJzY3JpcHRpb247XG4gICAgcHJvdGVjdGVkIG1hdGNoZXI6IEVsZW1lbnRNYXRjaGVyO1xuICAgIHByb3RlY3RlZCBleGVjdXRvcjogU2NvcGVFeGVjdXRvcjtcblxuICAgIGNvbnN0cnVjdG9yKGVsZW1lbnQ6IEVsZW1lbnQsIG1hdGNoZXI6IEVsZW1lbnRNYXRjaGVyLCBleGVjdXRvcjogU2NvcGVFeGVjdXRvcikge1xuICAgICAgICBzdXBlcihlbGVtZW50KTtcblxuICAgICAgICB0aGlzLm1hdGNoZXIgPSBtYXRjaGVyO1xuICAgICAgICB0aGlzLmV4ZWN1dG9yID0gZXhlY3V0b3I7XG5cbiAgICAgICAgdGhpcy5zdWJzY3JpcHRpb24gPSBuZXcgRWxlbWVudE1hdGNoZXNTdWJzY3JpcHRpb24odGhpcy5lbGVtZW50LCB0aGlzLm1hdGNoZXIsIChldmVudDogRWxlbWVudE1hdGNoZXNDaGFuZ2VkRXZlbnQpID0+IHtcbiAgICAgICAgICAgIGlmKGV2ZW50LmlzTWF0Y2hpbmcpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmFkZENoaWxkU2NvcGVCeUVsZW1lbnQoZWxlbWVudCwgdGhpcy5leGVjdXRvcik7XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICB0aGlzLnJlbW92ZUNoaWxkU2NvcGVCeUVsZW1lbnQoZWxlbWVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGluc3BlY3QoKTogdm9pZCB7XG4gICAgICAgICg8YW55PmNvbnNvbGUuZ3JvdXApKCcmJywgdGhpcy5tYXRjaGVyLCAnKCcgKyB0aGlzLmNoaWxkU2NvcGVzLmxlbmd0aCArICcgbWF0Y2hlcyknKTtcblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgZm9yKGxldCBjaGlsZFNjb3BlIG9mIHRoaXMuY2hpbGRTY29wZXMpIHtcbiAgICAgICAgICAgICAgICBjaGlsZFNjb3BlLmluc3BlY3QoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfWZpbmFsbHl7XG4gICAgICAgICAgICBjb25zb2xlLmdyb3VwRW5kKCk7XG4gICAgICAgIH1cbiAgICB9XG59IiwiZXhwb3J0IGRlZmF1bHQgRWxlbWVudENvbGxlY3RvcjtcblxuZXhwb3J0IGludGVyZmFjZSBFbGVtZW50VmlzdG9yIHsgKGVsZW1lbnQ6IEVsZW1lbnQpOiBFbGVtZW50TWF0Y2hlciB8IGJvb2xlYW4gfVxuZXhwb3J0IGRlY2xhcmUgdHlwZSBFbGVtZW50TWF0Y2hlciA9IHN0cmluZyB8IE5vZGVMaXN0T2Y8RWxlbWVudD4gfCBFbGVtZW50W10gfCBFbGVtZW50VmlzdG9yO1xuXG5leHBvcnQgY2xhc3MgRWxlbWVudENvbGxlY3RvciB7XG4gICAgcHJpdmF0ZSBzdGF0aWMgaW5zdGFuY2U6IEVsZW1lbnRDb2xsZWN0b3I7XG4gICAgXG4gICAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgRUxFTUVOVF9NQVRDSEVSX1RZUEVfRVJST1JfTUVTU0FHRSA9IFwiRGVjbDogQW4gYEVsZW1lbnRNYXRjaGVyYCBtdXN0IGJlIGEgQ1NTIHNlbGVjdG9yIChzdHJpbmcpIG9yIGEgZnVuY3Rpb24gd2hpY2ggdGFrZXMgYSBub2RlIHVuZGVyIGNvbnNpZGVyYXRpb24gYW5kIHJldHVybnMgYSBDU1Mgc2VsZWN0b3IgKHN0cmluZykgdGhhdCBtYXRjaGVzIGFsbCBtYXRjaGluZyBub2RlcyBpbiB0aGUgc3VidHJlZSwgYW4gYXJyYXktbGlrZSBvYmplY3Qgb2YgbWF0Y2hpbmcgbm9kZXMgaW4gdGhlIHN1YnRyZWUsIG9yIGEgYm9vbGVhbiB2YWx1ZSBhcyB0byB3aGV0aGVyIHRoZSBub2RlIHNob3VsZCBiZSBpbmNsdWRlZCAoaW4gdGhpcyBjYXNlLCB0aGUgZnVuY3Rpb24gd2lsbCBiZSBpbnZva2VkIGFnYWluIGZvciBhbGwgY2hpbGRyZW4gb2YgdGhlIG5vZGUpLlwiO1xuXG4gICAgc3RhdGljIGlzTWF0Y2hpbmdFbGVtZW50KHJvb3RFbGVtZW50OiBFbGVtZW50LCBlbGVtZW50TWF0Y2hlcjogRWxlbWVudE1hdGNoZXIpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0SW5zdGFuY2UoKS5pc01hdGNoaW5nRWxlbWVudChyb290RWxlbWVudCwgZWxlbWVudE1hdGNoZXIpO1xuICAgIH1cblxuICAgIHN0YXRpYyBjb2xsZWN0TWF0Y2hpbmdFbGVtZW50cyhyb290RWxlbWVudDogRWxlbWVudCwgZWxlbWVudE1hdGNoZXI6IEVsZW1lbnRNYXRjaGVyKTogRWxlbWVudFtdIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0SW5zdGFuY2UoKS5jb2xsZWN0TWF0Y2hpbmdFbGVtZW50cyhyb290RWxlbWVudCwgZWxlbWVudE1hdGNoZXIpO1xuICAgIH1cblxuICAgIHByaXZhdGUgc3RhdGljIGdldEluc3RhbmNlKCkgOiBFbGVtZW50Q29sbGVjdG9yIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuaW5zdGFuY2UgfHwgKHRoaXMuaW5zdGFuY2UgPSBuZXcgRWxlbWVudENvbGxlY3RvcigpKTtcbiAgICB9XG5cbiAgICBpc01hdGNoaW5nRWxlbWVudChlbGVtZW50OiBFbGVtZW50LCBlbGVtZW50TWF0Y2hlcjogRWxlbWVudE1hdGNoZXIpOiBib29sZWFuIHtcbiAgICAgICAgc3dpdGNoKHR5cGVvZihlbGVtZW50TWF0Y2hlcikpIHtcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihFbGVtZW50Q29sbGVjdG9yLkVMRU1FTlRfTUFUQ0hFUl9UWVBFX0VSUk9SX01FU1NBR0UpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgY2FzZSAnc3RyaW5nJzpcbiAgICAgICAgICAgICAgICBsZXQgY3NzU2VsZWN0b3I6IHN0cmluZyA9IDxzdHJpbmc+ZWxlbWVudE1hdGNoZXI7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuaXNNYXRjaGluZ0VsZW1lbnRGcm9tQ3NzU2VsZWN0b3IoZWxlbWVudCwgY3NzU2VsZWN0b3IpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBjYXNlICdvYmplY3QnOlxuICAgICAgICAgICAgICAgIGxldCBvYmplY3QgPSA8T2JqZWN0PmVsZW1lbnRNYXRjaGVyO1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmlzTWF0Y2hpbmdFbGVtZW50RnJvbU9iamVjdChlbGVtZW50LCBvYmplY3QpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgY2FzZSAnZnVuY3Rpb24nOlxuICAgICAgICAgICAgICAgIGxldCBlbGVtZW50VmlzdG9yID0gPEVsZW1lbnRWaXN0b3I+ZWxlbWVudE1hdGNoZXI7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuaXNNYXRjaGluZ0VsZW1lbnRGcm9tRWxlbWVudFZpc3RvcihlbGVtZW50LCBlbGVtZW50VmlzdG9yKTsgICAgICAgXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb2xsZWN0TWF0Y2hpbmdFbGVtZW50cyhlbGVtZW50OiBFbGVtZW50LCBlbGVtZW50TWF0Y2hlcjogRWxlbWVudE1hdGNoZXIpOiBFbGVtZW50W10ge1xuICAgICAgICBzd2l0Y2godHlwZW9mKGVsZW1lbnRNYXRjaGVyKSkge1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKEVsZW1lbnRDb2xsZWN0b3IuRUxFTUVOVF9NQVRDSEVSX1RZUEVfRVJST1JfTUVTU0FHRSk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBjYXNlICdzdHJpbmcnOlxuICAgICAgICAgICAgICAgIGxldCBjc3NTZWxlY3Rvcjogc3RyaW5nID0gPHN0cmluZz5lbGVtZW50TWF0Y2hlcjtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5jb2xsZWN0TWF0Y2hpbmdFbGVtZW50c0Zyb21Dc3NTZWxlY3RvcihlbGVtZW50LCBjc3NTZWxlY3Rvcik7XG5cbiAgICAgICAgICAgIGNhc2UgJ29iamVjdCc6XG4gICAgICAgICAgICAgICAgbGV0IG9iamVjdCA9IDxPYmplY3Q+ZWxlbWVudE1hdGNoZXI7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuY29sbGVjdE1hdGNoaW5nRWxlbWVudHNGcm9tT2JqZWN0KGVsZW1lbnQsIG9iamVjdCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICBjYXNlICdmdW5jdGlvbic6XG4gICAgICAgICAgICAgICAgbGV0IGVsZW1lbnRWaXN0b3IgPSA8RWxlbWVudFZpc3Rvcj5lbGVtZW50TWF0Y2hlcjtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5jb2xsZWN0TWF0Y2hpbmdFbGVtZW50c0Zyb21FbGVtZW50VmlzdG9yKGVsZW1lbnQsIGVsZW1lbnRWaXN0b3IpOyAgICAgICBcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgaXNNYXRjaGluZ0VsZW1lbnRGcm9tQ3NzU2VsZWN0b3IoZWxlbWVudDogRWxlbWVudCwgY3NzU2VsZWN0b3I6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgICAgICBpZih0eXBlb2YoZWxlbWVudC5tYXRjaGVzKSA9PT0gJ2Z1bmN0aW9uJykgeyAvLyB0YWtlIGEgc2hvcnRjdXQgaW4gbW9kZXJuIGJyb3dzZXJzXG4gICAgICAgICAgICByZXR1cm4gZWxlbWVudC5tYXRjaGVzKGNzc1NlbGVjdG9yKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICByZXR1cm4gaXNNZW1iZXJPZkFycmF5TGlrZShkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKGNzc1NlbGVjdG9yKSwgZWxlbWVudCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGlzTWF0Y2hpbmdFbGVtZW50RnJvbU9iamVjdChlbGVtZW50OiBFbGVtZW50LCBvYmplY3Q6IE9iamVjdCk6IGJvb2xlYW4ge1xuICAgICAgICBpZihvYmplY3QgPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICBpZihpc0FycmF5TGlrZShvYmplY3QpKSB7XG4gICAgICAgICAgICAgICAgbGV0IGFycmF5TGlrZSA9IDxBcnJheUxpa2U8YW55Pj5vYmplY3Q7XG5cbiAgICAgICAgICAgICAgICBpZihhcnJheUxpa2UubGVuZ3RoID09PSAwIHx8IGFycmF5TGlrZVswXSBpbnN0YW5jZW9mIEVsZW1lbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGlzTWVtYmVyT2ZBcnJheUxpa2UoYXJyYXlMaWtlLCBlbGVtZW50KTsgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoRWxlbWVudENvbGxlY3Rvci5FTEVNRU5UX01BVENIRVJfVFlQRV9FUlJPUl9NRVNTQUdFKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKEVsZW1lbnRDb2xsZWN0b3IuRUxFTUVOVF9NQVRDSEVSX1RZUEVfRVJST1JfTUVTU0FHRSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGlzTWF0Y2hpbmdFbGVtZW50RnJvbUVsZW1lbnRWaXN0b3IoZWxlbWVudDogRWxlbWVudCwgZWxlbWVudFZpc3RvcjogRWxlbWVudFZpc3Rvcik6IGJvb2xlYW4ge1xuICAgICAgICBsZXQgdmlzaXRvclJlc3VsdCA9IGVsZW1lbnRWaXN0b3IoZWxlbWVudCk7XG5cbiAgICAgICAgaWYodHlwZW9mKHZpc2l0b3JSZXN1bHQpID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIGxldCBpc01hdGNoID0gPGJvb2xlYW4+dmlzaXRvclJlc3VsdDtcbiAgICAgICAgICAgIHJldHVybiBpc01hdGNoO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIGxldCBlbGVtZW50TWF0Y2hlciA9IDxFbGVtZW50TWF0Y2hlcj52aXNpdG9yUmVzdWx0O1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaXNNYXRjaGluZ0VsZW1lbnQoZWxlbWVudCwgZWxlbWVudE1hdGNoZXIpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjb2xsZWN0TWF0Y2hpbmdFbGVtZW50c0Zyb21Dc3NTZWxlY3RvcihlbGVtZW50OiBFbGVtZW50LCBjc3NTZWxlY3Rvcjogc3RyaW5nKTogRWxlbWVudFtdIHtcbiAgICAgICAgcmV0dXJuIHRvQXJyYXk8RWxlbWVudD4oZWxlbWVudC5xdWVyeVNlbGVjdG9yQWxsKGNzc1NlbGVjdG9yKSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjb2xsZWN0TWF0Y2hpbmdFbGVtZW50c0Zyb21PYmplY3QoX2VsZW1lbnQ6IEVsZW1lbnQsIG9iamVjdDogT2JqZWN0KTogRWxlbWVudFtdIHtcbiAgICAgICAgaWYob2JqZWN0ID09PSBudWxsKSB7XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgICAgaWYoaXNBcnJheUxpa2Uob2JqZWN0KSkge1xuICAgICAgICAgICAgICAgIGxldCBhcnJheUxpa2UgPSA8QXJyYXlMaWtlPGFueT4+b2JqZWN0O1xuXG4gICAgICAgICAgICAgICAgaWYoYXJyYXlMaWtlLmxlbmd0aCA9PT0gMCB8fCBhcnJheUxpa2VbMF0gaW5zdGFuY2VvZiBFbGVtZW50KSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0b0FycmF5PEVsZW1lbnQ+KGFycmF5TGlrZSk7ICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKEVsZW1lbnRDb2xsZWN0b3IuRUxFTUVOVF9NQVRDSEVSX1RZUEVfRVJST1JfTUVTU0FHRSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihFbGVtZW50Q29sbGVjdG9yLkVMRU1FTlRfTUFUQ0hFUl9UWVBFX0VSUk9SX01FU1NBR0UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjb2xsZWN0TWF0Y2hpbmdFbGVtZW50c0Zyb21FbGVtZW50VmlzdG9yKGVsZW1lbnQ6IEVsZW1lbnQsIGVsZW1lbnRWaXN0b3I6IEVsZW1lbnRWaXN0b3IpOiBFbGVtZW50W10ge1xuICAgICAgICBsZXQgZWxlbWVudHM6IEVsZW1lbnRbXSA9IFtdO1xuICAgICAgICBsZXQgY2hpbGRyZW4gPSBlbGVtZW50LmNoaWxkcmVuO1xuICAgICAgICBcbiAgICAgICAgZm9yKGxldCBpbmRleCA9IDAsIGxlbmd0aCA9IGNoaWxkcmVuLmxlbmd0aDsgaW5kZXggPCBsZW5ndGg7IGluZGV4KyspIHtcbiAgICAgICAgICAgIGxldCBjaGlsZCA9IGNoaWxkcmVuW2luZGV4XTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYoY2hpbGQgaW5zdGFuY2VvZiBFbGVtZW50KSB7XG4gICAgICAgICAgICAgICAgbGV0IGVsZW1lbnQ6IEVsZW1lbnQgPSBjaGlsZDtcbiAgICAgICAgICAgICAgICBsZXQgdmlzaXRvclJlc3VsdCA9IGVsZW1lbnRWaXN0b3IoZWxlbWVudCk7XG5cbiAgICAgICAgICAgICAgICBpZih0eXBlb2YodmlzaXRvclJlc3VsdCkgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgICAgICAgICBsZXQgaXNNYXRjaCA9IDxib29sZWFuPnZpc2l0b3JSZXN1bHQ7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYoaXNNYXRjaCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZWxlbWVudHMucHVzaChlbGVtZW50KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgICAgICBlbGVtZW50cy5wdXNoKC4uLnRoaXMuY29sbGVjdE1hdGNoaW5nRWxlbWVudHMoZWxlbWVudCwgdmlzaXRvclJlc3VsdCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlbGVtZW50cztcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGlzQXJyYXlMaWtlKHZhbHVlOiBhbnkpIHtcbiAgICByZXR1cm4gdHlwZW9mKHZhbHVlKSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mKHZhbHVlLmxlbmd0aCkgPT09ICdudW1iZXInO1xufVxuXG5mdW5jdGlvbiB0b0FycmF5PFQ+KGFycmF5TGlrZTogQXJyYXlMaWtlPFQ+KTogQXJyYXk8VD4ge1xuICAgIGlmKGlzQXJyYXlMaWtlKGFycmF5TGlrZSkpIHtcbiAgICAgICAgcmV0dXJuIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFycmF5TGlrZSwgMCk7XG4gICAgfWVsc2V7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0V4cGVjdGVkIEFycmF5TGlrZScpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gaXNNZW1iZXJPZkFycmF5TGlrZShoYXlzdGFjazogQXJyYXlMaWtlPGFueT4sICBuZWVkbGU6IGFueSkge1xuICAgIHJldHVybiBBcnJheS5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKGhheXN0YWNrLCBuZWVkbGUpICE9PSAtMTtcbn1cbiIsImltcG9ydCB7IERlY2xhcmF0aW9uLCBTdWJzY3JpcHRpb25FeGVjdXRvciB9IGZyb20gJy4vZGVjbGFyYXRpb25zL2RlY2xhcmF0aW9uJztcbmltcG9ydCB7IE1hdGNoRGVjbGFyYXRpb24gfSBmcm9tICcuL2RlY2xhcmF0aW9ucy9tYXRjaF9kZWNsYXJhdGlvbic7XG5pbXBvcnQgeyBVbm1hdGNoRGVjbGFyYXRpb24gfSBmcm9tICcuL2RlY2xhcmF0aW9ucy91bm1hdGNoX2RlY2xhcmF0aW9uJztcbmltcG9ydCB7IE9uRGVjbGFyYXRpb24sIEV2ZW50TWF0Y2hlciB9IGZyb20gJy4vZGVjbGFyYXRpb25zL29uX2RlY2xhcmF0aW9uJztcblxuaW1wb3J0IHsgRWxlbWVudE1hdGNoZXIgfSBmcm9tICcuL2RlY2xhcmF0aW9ucy9zY29wZV90cmFja2luZ19kZWNsYXJhdGlvbic7XG5pbXBvcnQgeyBTZWxlY3REZWNsYXJhdGlvbiB9IGZyb20gJy4vZGVjbGFyYXRpb25zL3NlbGVjdF9kZWNsYXJhdGlvbic7XG5pbXBvcnQgeyBXaGVuRGVjbGFyYXRpb24gfSBmcm9tICcuL2RlY2xhcmF0aW9ucy93aGVuX2RlY2xhcmF0aW9uJztcblxuZXhwb3J0IHsgRGVjbGFyYXRpb24sIFN1YnNjcmlwdGlvbkV4ZWN1dG9yLCBFbGVtZW50TWF0Y2hlciwgRXZlbnRNYXRjaGVyIH07XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2NvcGVFeGVjdXRvciB7IFxuICAgIChzY29wZTogU2NvcGUsIGVsZW1lbnQ6IEVsZW1lbnQpOiB2b2lkXG59O1xuXG5leHBvcnQgY2xhc3MgU2NvcGUge1xuICAgIHN0YXRpYyBidWlsZFJvb3RTY29wZShlbGVtZW50OiBFbGVtZW50KTogU2NvcGUge1xuICAgICAgICBsZXQgc2NvcGUgPSBuZXcgU2NvcGUoZWxlbWVudCk7XG4gICAgICAgIHNjb3BlLmFjdGl2YXRlKCk7XG5cbiAgICAgICAgcmV0dXJuIHNjb3BlO1xuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgZWxlbWVudDogRWxlbWVudDtcblxuICAgIHByaXZhdGUgaXNBY3RpdmF0ZWQ6IGJvb2xlYW4gPSBmYWxzZTtcbiAgICBwcml2YXRlIGRlY2xhcmF0aW9uczogRGVjbGFyYXRpb25bXSA9IFtdO1xuXG4gICAgY29uc3RydWN0b3IoZWxlbWVudDogRWxlbWVudCwgZXhlY3V0b3I/OiBTY29wZUV4ZWN1dG9yKSB7XG4gICAgICAgIHRoaXMuZWxlbWVudCA9IGVsZW1lbnQ7XG5cbiAgICAgICAgaWYoZXhlY3V0b3IpIHtcbiAgICAgICAgICAgIGV4ZWN1dG9yLmNhbGwodGhpcywgdGhpcywgdGhpcy5lbGVtZW50KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGdldEVsZW1lbnQoKTogRWxlbWVudCB7XG4gICAgICAgIHJldHVybiB0aGlzLmVsZW1lbnQ7XG4gICAgfVxuXG4gICAgZ2V0RGVjbGFyYXRpb25zKCk6IERlY2xhcmF0aW9uW10ge1xuICAgICAgICByZXR1cm4gdGhpcy5kZWNsYXJhdGlvbnM7XG4gICAgfVxuXG4gICAgaW5zcGVjdCgpOiB2b2lkIHtcbiAgICAgICAgaWYodGhpcy5pc0FjdGl2YXRlZCkge1xuICAgICAgICAgICAgKDxhbnk+Y29uc29sZS5ncm91cCkodGhpcy5lbGVtZW50LCAnKGFjdGl2ZSknKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAoPGFueT5jb25zb2xlLmdyb3VwKSh0aGlzLmVsZW1lbnQsICcoaW5hY3RpdmUpJyk7XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgZm9yKGxldCBkZWNsYXJhdGlvbiBvZiB0aGlzLmRlY2xhcmF0aW9ucykge1xuICAgICAgICAgICAgICAgIGRlY2xhcmF0aW9uLmluc3BlY3QoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfWZpbmFsbHl7XG4gICAgICAgICAgICAoPGFueT5jb25zb2xlLmdyb3VwRW5kKSgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWN0aXZhdGUoKTogdm9pZCB7XG4gICAgICAgIGlmKCF0aGlzLmlzQWN0aXZhdGVkKSB7XG4gICAgICAgICAgICB0aGlzLmlzQWN0aXZhdGVkID0gdHJ1ZTtcblxuICAgICAgICAgICAgZm9yKGxldCBkZWNsYXJhdGlvbiBvZiB0aGlzLmRlY2xhcmF0aW9ucykge1xuICAgICAgICAgICAgICAgIGRlY2xhcmF0aW9uLmFjdGl2YXRlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBkZWFjdGl2YXRlKCk6IHZvaWQgeyAgICAgICAgXG4gICAgICAgIGlmKHRoaXMuaXNBY3RpdmF0ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuaXNBY3RpdmF0ZWQgPSBmYWxzZTsgICAgICAgICAgICBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgZm9yKGxldCBkZWNsYXJhdGlvbiBvZiB0aGlzLmRlY2xhcmF0aW9ucykge1xuICAgICAgICAgICAgICAgIGRlY2xhcmF0aW9uLmRlYWN0aXZhdGUoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXN0aW5lKCk6IHZvaWQge1xuICAgICAgICB0aGlzLmRlYWN0aXZhdGUoKTtcbiAgICAgICAgdGhpcy5yZW1vdmVBbGxEZWNsYXJhdGlvbnMoKTtcbiAgICB9XG5cbiAgICBtYXRjaChleGVjdXRvcjogU3Vic2NyaXB0aW9uRXhlY3V0b3IpOiBTY29wZSB7XG4gICAgICAgIHRoaXMuYWRkRGVjbGFyYXRpb24obmV3IE1hdGNoRGVjbGFyYXRpb24odGhpcy5lbGVtZW50LCBleGVjdXRvcikpO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHVubWF0Y2goZXhlY3V0b3I6IFN1YnNjcmlwdGlvbkV4ZWN1dG9yKTogU2NvcGUge1xuICAgICAgICB0aGlzLmFkZERlY2xhcmF0aW9uKG5ldyBVbm1hdGNoRGVjbGFyYXRpb24odGhpcy5lbGVtZW50LCBleGVjdXRvcikpO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHNlbGVjdChtYXRjaGVyOiBFbGVtZW50TWF0Y2hlciwgZXhlY3V0b3I6IFNjb3BlRXhlY3V0b3IpOiBTY29wZSB7XG4gICAgICAgIHRoaXMuYWRkRGVjbGFyYXRpb24obmV3IFNlbGVjdERlY2xhcmF0aW9uKHRoaXMuZWxlbWVudCwgbWF0Y2hlciwgZXhlY3V0b3IpKTtcblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG5cbiAgICB3aGVuKG1hdGNoZXI6IEVsZW1lbnRNYXRjaGVyLCBleGVjdXRvcjogU2NvcGVFeGVjdXRvcik6IFNjb3BlIHtcblx0XHR0aGlzLmFkZERlY2xhcmF0aW9uKG5ldyBXaGVuRGVjbGFyYXRpb24odGhpcy5lbGVtZW50LCBtYXRjaGVyLCBleGVjdXRvcikpO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIG9uKGV2ZW50TWF0Y2hlcjogRXZlbnRNYXRjaGVyLCBleGVjdXRvcjogU3Vic2NyaXB0aW9uRXhlY3V0b3IpOiBTY29wZTtcbiAgICBvbihldmVudE1hdGNoZXI6IEV2ZW50TWF0Y2hlciwgZWxlbWVudE1hdGNoZXI6IEVsZW1lbnRNYXRjaGVyLCBleGVjdXRvcjogU3Vic2NyaXB0aW9uRXhlY3V0b3IpOiBTY29wZTtcbiAgICBvbihldmVudE1hdGNoZXI6IEV2ZW50TWF0Y2hlciwgZXhlY3V0b3JPckVsZW1lbnRNYXRjaGVyOiBTdWJzY3JpcHRpb25FeGVjdXRvciB8IEVsZW1lbnRNYXRjaGVyLCBtYXliZUV4ZWN1dG9yPzogU3Vic2NyaXB0aW9uRXhlY3V0b3IpOiBTY29wZSB7XG4gICAgICAgIGxldCBhcmd1bWVudHNDb3VudCA9IGFyZ3VtZW50cy5sZW5ndGg7XG5cbiAgICAgICAgc3dpdGNoKGFyZ3VtZW50c0NvdW50KSB7XG4gICAgICAgICAgICBjYXNlIDI6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMub25XaXRoVHdvQXJndW1lbnRzKGV2ZW50TWF0Y2hlciwgPFN1YnNjcmlwdGlvbkV4ZWN1dG9yPmV4ZWN1dG9yT3JFbGVtZW50TWF0Y2hlcik7XG4gICAgICAgICAgICBjYXNlIDM6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMub25XaXRoVGhyZWVBcmd1bWVudHMoZXZlbnRNYXRjaGVyLCA8RWxlbWVudE1hdGNoZXI+ZXhlY3V0b3JPckVsZW1lbnRNYXRjaGVyLCA8U3Vic2NyaXB0aW9uRXhlY3V0b3I+bWF5YmVFeGVjdXRvcik7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJGYWlsZWQgdG8gZXhlY3V0ZSAnb24nIG9uICdTY29wZSc6IDIgb3IgMyBhcmd1bWVudHMgcmVxdWlyZWQsIGJ1dCBcIiArIGFyZ3VtZW50c0NvdW50ICsgXCIgcHJlc2VudC5cIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIG9uV2l0aFR3b0FyZ3VtZW50cyhldmVudE1hdGNoZXI6IEV2ZW50TWF0Y2hlciwgZXhlY3V0b3I6IFN1YnNjcmlwdGlvbkV4ZWN1dG9yKTogU2NvcGUge1xuICAgICAgICB0aGlzLmFkZERlY2xhcmF0aW9uKG5ldyBPbkRlY2xhcmF0aW9uKHRoaXMuZWxlbWVudCwgZXZlbnRNYXRjaGVyLCBleGVjdXRvcikpO1xuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cblxuICAgIHByaXZhdGUgb25XaXRoVGhyZWVBcmd1bWVudHMoZXZlbnRNYXRjaGVyOiBFdmVudE1hdGNoZXIsIGVsZW1lbnRNYXRjaGVyOiBFbGVtZW50TWF0Y2hlciwgZXhlY3V0b3I6IFN1YnNjcmlwdGlvbkV4ZWN1dG9yKTogU2NvcGUge1xuICAgICAgICB0aGlzLnNlbGVjdChlbGVtZW50TWF0Y2hlciwgKHNjb3BlKSA9PiB7XG4gICAgICAgICAgICBzY29wZS5vbihldmVudE1hdGNoZXIsIGV4ZWN1dG9yKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhZGREZWNsYXJhdGlvbihkZWNsYXJhdGlvbjogRGVjbGFyYXRpb24pOiB2b2lkIHtcbiAgICAgICAgdGhpcy5kZWNsYXJhdGlvbnMucHVzaChkZWNsYXJhdGlvbik7XG5cbiAgICAgICAgaWYodGhpcy5pc0FjdGl2YXRlZCkge1xuICAgICAgICAgICAgZGVjbGFyYXRpb24uYWN0aXZhdGUoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgcmVtb3ZlRGVjbGFyYXRpb24oZGVjbGFyYXRpb246IERlY2xhcmF0aW9uKTogdm9pZCB7ICBcbiAgICAgICAgbGV0IGluZGV4ID0gdGhpcy5kZWNsYXJhdGlvbnMuaW5kZXhPZihkZWNsYXJhdGlvbik7XG5cbiAgICAgICAgaWYoaW5kZXggPj0gMCkge1xuICAgICAgICAgICAgdGhpcy5kZWNsYXJhdGlvbnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRlY2xhcmF0aW9uLmRlYWN0aXZhdGUoKTsgICAgICAgIFxuICAgIH1cblxuICAgIHByaXZhdGUgcmVtb3ZlQWxsRGVjbGFyYXRpb25zKCkgeyAgICAgICAgXG4gICAgICAgIGxldCBkZWNsYXJhdGlvbjogRGVjbGFyYXRpb247XG5cbiAgICAgICAgd2hpbGUoZGVjbGFyYXRpb24gPSB0aGlzLmRlY2xhcmF0aW9uc1swXSkge1xuICAgICAgICAgICAgdGhpcy5yZW1vdmVEZWNsYXJhdGlvbihkZWNsYXJhdGlvbik7XG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQgeyBTdWJzY3JpcHRpb24sIFN1YnNjcmlwdGlvbkV4ZWN1dG9yLCBTdWJzY3JpcHRpb25FdmVudCB9IGZyb20gJy4vc3Vic2NyaXB0aW9uJztcblxuaW50ZXJmYWNlIENvbW1vbkpzUmVxdWlyZSB7XG4gICAgKGlkOiBzdHJpbmcpOiBhbnk7XG59XG5cbmRlY2xhcmUgdmFyIHJlcXVpcmU6IENvbW1vbkpzUmVxdWlyZTtcbmxldCBNdXRhdGlvbk9ic2VydmVyID0gcmVxdWlyZSgnbXV0YXRpb24tb2JzZXJ2ZXInKTsgLy8gdXNlIHBvbHlmaWxsXG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXRjaGVkTXV0YXRpb25TdWJzY3JpcHRpb24gZXh0ZW5kcyBTdWJzY3JpcHRpb24ge1xuICAgIHN0YXRpYyByZWFkb25seSBtdXRhdGlvbk9ic2VydmVySW5pdDogTXV0YXRpb25PYnNlcnZlckluaXQgPSB7XG4gICAgICAgIGNoaWxkTGlzdDogdHJ1ZSxcbiAgICAgICAgYXR0cmlidXRlczogdHJ1ZSxcbiAgICAgICAgY2hhcmFjdGVyRGF0YTogdHJ1ZSxcbiAgICAgICAgc3VidHJlZTogdHJ1ZVxuICAgIH07XG5cbiAgICBwcml2YXRlIGlzTGlzdGVuaW5nIDogYm9vbGVhbiA9IGZhbHNlO1xuICAgIHByaXZhdGUgaGFuZGxlTXV0YXRpb25UaW1lb3V0IDogYW55ID0gbnVsbDtcblxuICAgIHByaXZhdGUgcmVhZG9ubHkgbXV0YXRpb25DYWxsYmFjazogTXV0YXRpb25DYWxsYmFjaztcbiAgICBwcml2YXRlIHJlYWRvbmx5IG11dGF0aW9uT2JzZXJ2ZXI6IE11dGF0aW9uT2JzZXJ2ZXI7XG5cbiAgICBjb25zdHJ1Y3RvcihlbGVtZW50OiBFbGVtZW50LCBleGVjdXRvcjogU3Vic2NyaXB0aW9uRXhlY3V0b3IpIHtcbiAgICAgICAgc3VwZXIoZWxlbWVudCwgZXhlY3V0b3IpO1xuXG4gICAgICAgIHRoaXMubXV0YXRpb25DYWxsYmFjayA9ICgpOiB2b2lkID0+IHtcbiAgICAgICAgICAgIHRoaXMuZGVmZXJIYW5kbGVNdXRhdGlvbnMoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubXV0YXRpb25PYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHRoaXMubXV0YXRpb25DYWxsYmFjayk7XG4gICAgfVxuXG4gICAgcHJvdGVjdGVkIHN0YXJ0TGlzdGVuaW5nKCk6IHZvaWQge1xuICAgICAgICBpZighdGhpcy5pc0xpc3RlbmluZykge1xuICAgICAgICAgICAgdGhpcy5tdXRhdGlvbk9ic2VydmVyLm9ic2VydmUodGhpcy5lbGVtZW50LCBCYXRjaGVkTXV0YXRpb25TdWJzY3JpcHRpb24ubXV0YXRpb25PYnNlcnZlckluaXQpO1xuXG4gICAgICAgICAgICB0aGlzLmlzTGlzdGVuaW5nID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByb3RlY3RlZCBzdG9wTGlzdGVuaW5nKCk6IHZvaWQge1xuICAgICAgICBpZih0aGlzLmlzTGlzdGVuaW5nKSB7XG4gICAgICAgICAgICB0aGlzLm11dGF0aW9uT2JzZXJ2ZXIuZGlzY29ubmVjdCgpO1xuICAgICAgICAgICAgdGhpcy5oYW5kbGVNdXRhdGlvbnNOb3coKTtcblxuICAgICAgICAgICAgdGhpcy5pc0xpc3RlbmluZyA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIHByb3RlY3RlZCBhYnN0cmFjdCBoYW5kbGVNdXRhdGlvbnMoKTogdm9pZDtcblxuICAgIHByaXZhdGUgZGVmZXJIYW5kbGVNdXRhdGlvbnMoKTogdm9pZCB7XG4gICAgICAgIGlmKHRoaXMuaGFuZGxlTXV0YXRpb25UaW1lb3V0ID09PSBudWxsKSB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZU11dGF0aW9uVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4geyBcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm11dGF0aW9uT2JzZXJ2ZXIudGFrZVJlY29yZHMoKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVNdXRhdGlvbnMoKTtcbiAgICAgICAgICAgICAgICB9ZmluYWxseXtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVNdXRhdGlvblRpbWVvdXQgPSBudWxsO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sIDApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBoYW5kbGVNdXRhdGlvbnNOb3coKTogdm9pZCB7XG4gICAgICAgIGlmKHRoaXMuaGFuZGxlTXV0YXRpb25UaW1lb3V0ICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5oYW5kbGVNdXRhdGlvblRpbWVvdXQpO1xuICAgICAgICAgICAgdGhpcy5oYW5kbGVNdXRhdGlvblRpbWVvdXQgPSBudWxsO1xuXG4gICAgICAgICAgICB0aGlzLmhhbmRsZU11dGF0aW9ucygpOyAgICAgICAgICAgIFxuICAgICAgICB9XG4gICAgfVxufVxuXG5leHBvcnQgeyBTdWJzY3JpcHRpb24sIFN1YnNjcmlwdGlvbkV4ZWN1dG9yLCBTdWJzY3JpcHRpb25FdmVudCB9OyIsImltcG9ydCB7IEJhdGNoZWRNdXRhdGlvblN1YnNjcmlwdGlvbiwgU3Vic2NyaXB0aW9uRXhlY3V0b3IsIFN1YnNjcmlwdGlvbkV2ZW50IH0gZnJvbSAnLi9iYXRjaGVkX211dGF0aW9uX3N1YnNjcmlwdGlvbic7XG5pbXBvcnQgeyBFbGVtZW50TWF0Y2hlciwgRWxlbWVudENvbGxlY3RvciB9IGZyb20gJy4uL2VsZW1lbnRfY29sbGVjdG9yJztcblxuZXhwb3J0IGNsYXNzIEVsZW1lbnRNYXRjaGVzU3Vic2NyaXB0aW9uIGV4dGVuZHMgQmF0Y2hlZE11dGF0aW9uU3Vic2NyaXB0aW9uIHtcbiAgICByZWFkb25seSBtYXRjaGVyOiBFbGVtZW50TWF0Y2hlcjtcblxuICAgIHByaXZhdGUgaXNDb25uZWN0ZWQ6IGJvb2xlYW4gPSBmYWxzZTtcbiAgICBwcml2YXRlIGlzTWF0Y2hpbmdFbGVtZW50OiBib29sZWFuID0gZmFsc2U7XG5cbiAgICBjb25zdHJ1Y3RvcihlbGVtZW50OiBFbGVtZW50LCBtYXRjaGVyOiBFbGVtZW50TWF0Y2hlciwgZXhlY3V0b3I6IFN1YnNjcmlwdGlvbkV4ZWN1dG9yKSB7XG4gICAgICAgIHN1cGVyKGVsZW1lbnQsIGV4ZWN1dG9yKTtcblxuICAgICAgICB0aGlzLm1hdGNoZXIgPSBtYXRjaGVyO1xuICAgIH1cblxuICAgIGNvbm5lY3QoKTogdm9pZCB7XG4gICAgICAgIGlmKCF0aGlzLmlzQ29ubmVjdGVkKSB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUlzTWF0Y2hpbmdFbGVtZW50KHRoaXMuY29tcHV0ZUlzTWF0Y2hpbmdFbGVtZW50KCkpO1xuICAgICAgICAgICAgdGhpcy5zdGFydExpc3RlbmluZygpO1xuXG4gICAgICAgICAgICB0aGlzLmlzQ29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGRpc2Nvbm5lY3QoKTogdm9pZCB7XG4gICAgICAgIGlmKHRoaXMuaXNDb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuc3RvcExpc3RlbmluZygpO1xuICAgICAgICAgICAgdGhpcy51cGRhdGVJc01hdGNoaW5nRWxlbWVudChmYWxzZSk7XG5cbiAgICAgICAgICAgIHRoaXMuaXNDb25uZWN0ZWQgPSBmYWxzZTtcbiAgICAgICAgfSAgICAgICAgXG4gICAgfVxuXG4gICAgcHJvdGVjdGVkIGhhbmRsZU11dGF0aW9ucygpOiB2b2lkIHtcbiAgICAgICAgdGhpcy51cGRhdGVJc01hdGNoaW5nRWxlbWVudCh0aGlzLmNvbXB1dGVJc01hdGNoaW5nRWxlbWVudCgpKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHVwZGF0ZUlzTWF0Y2hpbmdFbGVtZW50KGlzTWF0Y2hpbmdFbGVtZW50OiBib29sZWFuKTogdm9pZCB7XG4gICAgICAgIGxldCB3YXNNYXRjaGluZ0VsZW1lbnQgPSB0aGlzLmlzTWF0Y2hpbmdFbGVtZW50O1xuICAgICAgICB0aGlzLmlzTWF0Y2hpbmdFbGVtZW50ID0gaXNNYXRjaGluZ0VsZW1lbnQ7XG5cbiAgICAgICAgaWYod2FzTWF0Y2hpbmdFbGVtZW50ICE9PSBpc01hdGNoaW5nRWxlbWVudCkge1xuICAgICAgICAgICAgbGV0IGV2ZW50ID0gbmV3IEVsZW1lbnRNYXRjaGVzQ2hhbmdlZEV2ZW50KHRoaXMsIGlzTWF0Y2hpbmdFbGVtZW50KTtcblxuICAgICAgICAgICAgdGhpcy5leGVjdXRvcihldmVudCwgdGhpcy5lbGVtZW50KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgY29tcHV0ZUlzTWF0Y2hpbmdFbGVtZW50KCk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gRWxlbWVudENvbGxlY3Rvci5pc01hdGNoaW5nRWxlbWVudCh0aGlzLmVsZW1lbnQsIHRoaXMubWF0Y2hlcik7XG4gICAgfVxufVxuXG5leHBvcnQgY2xhc3MgRWxlbWVudE1hdGNoZXNDaGFuZ2VkRXZlbnQgZXh0ZW5kcyBTdWJzY3JpcHRpb25FdmVudCB7XG4gICAgcmVhZG9ubHkgaXNNYXRjaGluZzogYm9vbGVhbjtcblxuICAgIGNvbnN0cnVjdG9yKGVsZW1lbnRNYXRjaGVzU3Vic2NyaXB0aW9uOiBFbGVtZW50TWF0Y2hlc1N1YnNjcmlwdGlvbiwgaXNNYXRjaGluZzogYm9vbGVhbikge1xuICAgICAgICBzdXBlcihlbGVtZW50TWF0Y2hlc1N1YnNjcmlwdGlvbiwgJ0VsZW1lbnRNYXRjaGVzQ2hhbmdlZEV2ZW50Jyk7XG5cbiAgICAgICAgdGhpcy5pc01hdGNoaW5nID0gaXNNYXRjaGluZztcbiAgICB9XG59XG5cbmV4cG9ydCB7IEVsZW1lbnRNYXRjaGVyIH07XG4iLCJpbXBvcnQgeyBTdWJzY3JpcHRpb24sIFN1YnNjcmlwdGlvbkV4ZWN1dG9yIH0gZnJvbSAnLi9zdWJzY3JpcHRpb24nO1xuXG5leHBvcnQgeyBTdWJzY3JpcHRpb25FeGVjdXRvciB9O1xuXG5leHBvcnQgY2xhc3MgRXZlbnRTdWJzY3JpcHRpb24gZXh0ZW5kcyBTdWJzY3JpcHRpb24ge1xuICAgIHJlYWRvbmx5IGV2ZW50TWF0Y2hlcjogRXZlbnRNYXRjaGVyO1xuICAgIHJlYWRvbmx5IGV2ZW50TmFtZXM6IHN0cmluZ1tdO1xuXG4gICAgcHJpdmF0ZSBpc0Nvbm5lY3RlZCA6IGJvb2xlYW4gPSBmYWxzZTsgICAgXG4gICAgcHJpdmF0ZSByZWFkb25seSBldmVudExpc3RlbmVyOiBFdmVudExpc3RlbmVyO1xuXG4gICAgY29uc3RydWN0b3IoZWxlbWVudDogRWxlbWVudCwgZXZlbnRNYXRjaGVyOiBFdmVudE1hdGNoZXIsIGV4ZWN1dG9yOiBTdWJzY3JpcHRpb25FeGVjdXRvcikge1xuICAgICAgICBzdXBlcihlbGVtZW50LCBleGVjdXRvcik7XG5cbiAgICAgICAgdGhpcy5ldmVudE1hdGNoZXIgPSBldmVudE1hdGNoZXI7XG4gICAgICAgIHRoaXMuZXZlbnROYW1lcyA9IHRoaXMucGFyc2VFdmVudE1hdGNoZXIodGhpcy5ldmVudE1hdGNoZXIpO1xuXG4gICAgICAgIHRoaXMuZXZlbnRMaXN0ZW5lciA9IChldmVudDogRXZlbnQpOiB2b2lkID0+IHtcbiAgICAgICAgICAgIHRoaXMuaGFuZGxlRXZlbnQoZXZlbnQpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29ubmVjdCgpOiB2b2lkIHtcbiAgICAgICAgaWYoIXRoaXMuaXNDb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuaXNDb25uZWN0ZWQgPSB0cnVlO1xuXG4gICAgICAgICAgICBmb3IobGV0IGV2ZW50TmFtZSBvZiB0aGlzLmV2ZW50TmFtZXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIHRoaXMuZXZlbnRMaXN0ZW5lciwgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgZGlzY29ubmVjdCgpOiB2b2lkIHtcbiAgICAgICAgaWYodGhpcy5pc0Nvbm5lY3RlZCkge1xuICAgICAgICAgICAgZm9yKGxldCBldmVudE5hbWUgb2YgdGhpcy5ldmVudE5hbWVzKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCB0aGlzLmV2ZW50TGlzdGVuZXIsIGZhbHNlKTtcbiAgICAgICAgICAgIH0gICAgICAgICAgICBcblxuICAgICAgICAgICAgdGhpcy5pc0Nvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBoYW5kbGVFdmVudChldmVudDogRXZlbnQpOiB2b2lkIHtcbiAgICAgICAgdGhpcy5leGVjdXRvcihldmVudCwgdGhpcy5lbGVtZW50KTsgICAgICAgICBcbiAgICB9XG5cbiAgICBwcml2YXRlIHBhcnNlRXZlbnRNYXRjaGVyKGV2ZW50TWF0Y2hlcjogRXZlbnRNYXRjaGVyKTogc3RyaW5nW10ge1xuICAgICAgICAvLyBUT0RPOiBTdXBwb3J0IGFsbCBvZiB0aGUgalF1ZXJ5IHN0eWxlIGV2ZW50IG9wdGlvbnNcbiAgICAgICAgcmV0dXJuIGV2ZW50TWF0Y2hlci5zcGxpdCgnICcpO1xuICAgIH0gXG59XG5cbmV4cG9ydCBkZWNsYXJlIHR5cGUgRXZlbnRNYXRjaGVyID0gc3RyaW5nO1xuIiwiaW1wb3J0IHsgQmF0Y2hlZE11dGF0aW9uU3Vic2NyaXB0aW9uLCBTdWJzY3JpcHRpb25FeGVjdXRvciwgU3Vic2NyaXB0aW9uRXZlbnQgfSBmcm9tICcuL2JhdGNoZWRfbXV0YXRpb25fc3Vic2NyaXB0aW9uJztcbmltcG9ydCB7IEVsZW1lbnRNYXRjaGVyLCBFbGVtZW50Q29sbGVjdG9yIH0gZnJvbSAnLi4vZWxlbWVudF9jb2xsZWN0b3InO1xuXG5leHBvcnQgeyBFbGVtZW50TWF0Y2hlciB9O1xuXG5leHBvcnQgY2xhc3MgTWF0Y2hpbmdFbGVtZW50c1N1YnNjcmlwdGlvbiBleHRlbmRzIEJhdGNoZWRNdXRhdGlvblN1YnNjcmlwdGlvbiB7XG4gICAgcmVhZG9ubHkgbWF0Y2hlcjogRWxlbWVudE1hdGNoZXI7XG5cbiAgICBwcml2YXRlIGlzQ29ubmVjdGVkOiBib29sZWFuID0gZmFsc2U7XG4gICAgcHJpdmF0ZSBtYXRjaGluZ0VsZW1lbnRzOiBFbGVtZW50W10gPSBbXTtcblxuICAgIGNvbnN0cnVjdG9yKGVsZW1lbnQ6IEVsZW1lbnQsIG1hdGNoZXI6IEVsZW1lbnRNYXRjaGVyLCBleGVjdXRvcjogU3Vic2NyaXB0aW9uRXhlY3V0b3IpIHtcbiAgICAgICAgc3VwZXIoZWxlbWVudCwgZXhlY3V0b3IpO1xuXG4gICAgICAgIHRoaXMubWF0Y2hlciA9IG1hdGNoZXI7XG4gICAgfVxuXG4gICAgY29ubmVjdCgpOiB2b2lkIHtcbiAgICAgICAgaWYoIXRoaXMuaXNDb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlTWF0Y2hpbmdFbGVtZW50cyh0aGlzLmNvbGxlY3RNYXRjaGluZ0VsZW1lbnRzKCkpO1xuICAgICAgICAgICAgdGhpcy5zdGFydExpc3RlbmluZygpO1xuXG4gICAgICAgICAgICB0aGlzLmlzQ29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGRpc2Nvbm5lY3QoKTogdm9pZCB7XG4gICAgICAgIGlmKHRoaXMuaXNDb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuc3RvcExpc3RlbmluZygpO1xuICAgICAgICAgICAgdGhpcy51cGRhdGVNYXRjaGluZ0VsZW1lbnRzKFtdKTtcblxuICAgICAgICAgICAgdGhpcy5pc0Nvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICB9ICAgICAgICBcbiAgICB9XG5cbiAgICBwcm90ZWN0ZWQgaGFuZGxlTXV0YXRpb25zKCk6IHZvaWQge1xuICAgICAgICB0aGlzLnVwZGF0ZU1hdGNoaW5nRWxlbWVudHModGhpcy5jb2xsZWN0TWF0Y2hpbmdFbGVtZW50cygpKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHVwZGF0ZU1hdGNoaW5nRWxlbWVudHMobWF0Y2hpbmdFbGVtZW50czogRWxlbWVudFtdKTogdm9pZCB7XG4gICAgICAgIGxldCBwcmV2aW91c2x5TWF0Y2hpbmdFbGVtZW50cyA9IHRoaXMubWF0Y2hpbmdFbGVtZW50cztcblxuICAgICAgICBsZXQgYWRkZWRFbGVtZW50cyA9IGFycmF5U3VidHJhY3QobWF0Y2hpbmdFbGVtZW50cywgcHJldmlvdXNseU1hdGNoaW5nRWxlbWVudHMpO1xuICAgICAgICBsZXQgcmVtb3ZlZEVsZW1lbnRzID0gYXJyYXlTdWJ0cmFjdChwcmV2aW91c2x5TWF0Y2hpbmdFbGVtZW50cywgbWF0Y2hpbmdFbGVtZW50cyk7XG5cbiAgICAgICAgdGhpcy5tYXRjaGluZ0VsZW1lbnRzID0gbWF0Y2hpbmdFbGVtZW50czsgICBcbiAgICAgICAgXG4gICAgICAgIGlmKGFkZGVkRWxlbWVudHMubGVuZ3RoID4gMCB8fCByZW1vdmVkRWxlbWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgbGV0IGV2ZW50ID0gbmV3IE1hdGNoaW5nRWxlbWVudHNDaGFuZ2VkRXZlbnQodGhpcywgYWRkZWRFbGVtZW50cywgcmVtb3ZlZEVsZW1lbnRzKTtcblxuICAgICAgICAgICAgdGhpcy5leGVjdXRvcihldmVudCwgdGhpcy5lbGVtZW50KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgY29sbGVjdE1hdGNoaW5nRWxlbWVudHMoKTogRWxlbWVudFtdIHtcbiAgICAgICAgcmV0dXJuIEVsZW1lbnRDb2xsZWN0b3IuY29sbGVjdE1hdGNoaW5nRWxlbWVudHModGhpcy5lbGVtZW50LCB0aGlzLm1hdGNoZXIpO1xuICAgIH1cbn1cblxuZXhwb3J0IGNsYXNzIE1hdGNoaW5nRWxlbWVudHNDaGFuZ2VkRXZlbnQgZXh0ZW5kcyBTdWJzY3JpcHRpb25FdmVudCB7XG4gICAgcmVhZG9ubHkgYWRkZWRFbGVtZW50czogRWxlbWVudFtdO1xuICAgIHJlYWRvbmx5IHJlbW92ZWRFbGVtZW50czogRWxlbWVudFtdO1xuXG4gICAgY29uc3RydWN0b3IobWF0Y2hpbmdFbGVtZW50c1N1YnNjcmlwdGlvbjogTWF0Y2hpbmdFbGVtZW50c1N1YnNjcmlwdGlvbiwgYWRkZWRFbGVtZW50czogRWxlbWVudFtdLCByZW1vdmVkRWxlbWVudHM6IEVsZW1lbnRbXSkge1xuICAgICAgICBzdXBlcihtYXRjaGluZ0VsZW1lbnRzU3Vic2NyaXB0aW9uLCAnTWF0Y2hpbmdFbGVtZW50c0NoYW5nZWQnKTtcblxuICAgICAgICB0aGlzLmFkZGVkRWxlbWVudHMgPSBhZGRlZEVsZW1lbnRzO1xuICAgICAgICB0aGlzLnJlbW92ZWRFbGVtZW50cyA9IHJlbW92ZWRFbGVtZW50cztcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGFycmF5U3VidHJhY3Q8VD4obWludWVuZDogVFtdLCBzdWJ0cmFoZW5kOiBUW10pOiBUW10ge1xuICAgIGxldCBkaWZmZXJlbmNlOiBUW10gPSBbXTtcblxuICAgIGZvcihsZXQgbWVtYmVyIG9mIG1pbnVlbmQpIHtcbiAgICAgICAgaWYoc3VidHJhaGVuZC5pbmRleE9mKG1lbWJlcikgPT09IC0xKSB7XG4gICAgICAgICAgICBkaWZmZXJlbmNlLnB1c2gobWVtYmVyKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBkaWZmZXJlbmNlO1xufSIsImV4cG9ydCBhYnN0cmFjdCBjbGFzcyBTdWJzY3JpcHRpb24ge1xuICAgIHJlYWRvbmx5IGV4ZWN1dG9yOiBTdWJzY3JpcHRpb25FeGVjdXRvcjtcbiAgICByZWFkb25seSBlbGVtZW50OiBFbGVtZW50O1xuICAgIFxuICAgIGNvbnN0cnVjdG9yKGVsZW1lbnQ6IEVsZW1lbnQsIGV4ZWN1dG9yOiBTdWJzY3JpcHRpb25FeGVjdXRvcikge1xuICAgICAgICB0aGlzLmVsZW1lbnQgPSBlbGVtZW50O1xuICAgICAgICB0aGlzLmV4ZWN1dG9yID0gZXhlY3V0b3I7XG4gICAgfVxuXG4gICAgYWJzdHJhY3QgY29ubmVjdCgpIDogdm9pZDtcbiAgICBhYnN0cmFjdCBkaXNjb25uZWN0KCkgOiB2b2lkO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN1YnNjcmlwdGlvbkV4ZWN1dG9yIHsgXG4gICAgKGV2ZW50OiBFdmVudCB8IFN1YnNjcmlwdGlvbkV2ZW50LCBlbGVtZW50OiBFbGVtZW50KTogdm9pZCBcbn1cblxuZXhwb3J0IGNsYXNzIFN1YnNjcmlwdGlvbkV2ZW50IHtcbiAgICByZWFkb25seSBzdWJzY3JpcHRpb246IFN1YnNjcmlwdGlvbjtcbiAgICByZWFkb25seSBuYW1lOiBzdHJpbmc7XG5cbiAgICBjb25zdHJ1Y3RvcihzdWJzY3JpcHRpb246IFN1YnNjcmlwdGlvbiwgbmFtZTogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuc3Vic2NyaXB0aW9uID0gc3Vic2NyaXB0aW9uO1xuICAgICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIH1cbn1cbiIsImltcG9ydCB7IFN1YnNjcmlwdGlvbiwgU3Vic2NyaXB0aW9uRXhlY3V0b3IsIFN1YnNjcmlwdGlvbkV2ZW50IH0gZnJvbSAnLi9zdWJzY3JpcHRpb24nO1xuXG5leHBvcnQgeyBTdWJzY3JpcHRpb25FeGVjdXRvciB9O1xuXG5leHBvcnQgaW50ZXJmYWNlIFRyaXZpYWxTdWJzY3JpcHRpb25Db25maWd1cmF0aW9uIHtcbiAgICBjb25uZWN0ZWQ/OiBib29sZWFuLFxuICAgIGRpc2Nvbm5lY3RlZD86IGJvb2xlYW5cbn1cblxuZXhwb3J0IGNsYXNzIEVsZW1lbnRDb25uZWN0aW9uQ2hhbmdlZEV2ZW50IGV4dGVuZHMgU3Vic2NyaXB0aW9uRXZlbnQge1xuICAgIHJlYWRvbmx5IGVsZW1lbnQ6IEVsZW1lbnQ7XG4gICAgcmVhZG9ubHkgaXNDb25uZWN0ZWQ6IGJvb2xlYW47XG5cbiAgICBjb25zdHJ1Y3Rvcih0cml2aWFsU3Vic2NyaXB0aW9uOiBUcml2aWFsU3Vic2NyaXB0aW9uLCBlbGVtZW50OiBFbGVtZW50LCBpc0Nvbm5lY3RlZDogYm9vbGVhbikge1xuICAgICAgICBzdXBlcih0cml2aWFsU3Vic2NyaXB0aW9uLCAnRWxlbWVudENvbm5lY3RlZCcpO1xuXG4gICAgICAgIHRoaXMuZWxlbWVudCA9IGVsZW1lbnQ7XG4gICAgICAgIHRoaXMuaXNDb25uZWN0ZWQgPSBpc0Nvbm5lY3RlZDtcbiAgICB9XG59XG5cbmV4cG9ydCBjbGFzcyBUcml2aWFsU3Vic2NyaXB0aW9uIGV4dGVuZHMgU3Vic2NyaXB0aW9uIHtcbiAgICBwcml2YXRlIGlzQ29ubmVjdGVkOiBib29sZWFuID0gZmFsc2U7XG4gICAgcHJpdmF0ZSBjb25maWc6IFRyaXZpYWxTdWJzY3JpcHRpb25Db25maWd1cmF0aW9uO1xuXG4gICAgY29uc3RydWN0b3IoZWxlbWVudDogRWxlbWVudCwgY29uZmlnOiBUcml2aWFsU3Vic2NyaXB0aW9uQ29uZmlndXJhdGlvbiwgZXhlY3V0b3I6IFN1YnNjcmlwdGlvbkV4ZWN1dG9yKSB7XG4gICAgICAgIHN1cGVyKGVsZW1lbnQsIGV4ZWN1dG9yKTtcblxuICAgICAgICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgICB9XG5cbiAgICBjb25uZWN0KCkge1xuICAgICAgICBpZighdGhpcy5pc0Nvbm5lY3RlZCkge1xuICAgICAgICAgICAgdGhpcy5pc0Nvbm5lY3RlZCA9IHRydWU7XG5cbiAgICAgICAgICAgIGlmKHRoaXMuY29uZmlnLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgICAgIHRoaXMuZXhlY3V0b3IodGhpcy5idWlsZEVsZW1lbnRDb25uZWN0aW9uQ2hhbmdlZEV2ZW50KCksIHRoaXMuZWxlbWVudCk7IFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgZGlzY29ubmVjdCgpIHtcbiAgICAgICAgaWYodGhpcy5pc0Nvbm5lY3RlZCkge1xuICAgICAgICAgICAgdGhpcy5pc0Nvbm5lY3RlZCA9IGZhbHNlO1xuXG4gICAgICAgICAgICBpZih0aGlzLmNvbmZpZy5kaXNjb25uZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmV4ZWN1dG9yKHRoaXMuYnVpbGRFbGVtZW50Q29ubmVjdGlvbkNoYW5nZWRFdmVudCgpLCB0aGlzLmVsZW1lbnQpOyAgICAgXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcHJpdmF0ZSBidWlsZEVsZW1lbnRDb25uZWN0aW9uQ2hhbmdlZEV2ZW50KCk6IEVsZW1lbnRDb25uZWN0aW9uQ2hhbmdlZEV2ZW50IHtcbiAgICAgICAgcmV0dXJuIG5ldyBFbGVtZW50Q29ubmVjdGlvbkNoYW5nZWRFdmVudCh0aGlzLCB0aGlzLmVsZW1lbnQsIHRoaXMuaXNDb25uZWN0ZWQpO1xuICAgIH1cbn0iXX0=
