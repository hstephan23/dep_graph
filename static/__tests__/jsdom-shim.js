/**
 * Minimal DOM shim — just enough for the modules under test to load and run.
 * Replaces the real jsdom package which we can't install in this environment.
 *
 * Covers: createElement, getElementById, querySelector/All, classList,
 * appendChild, textContent, innerHTML, style, event listeners, etc.
 */

class Style {
  constructor() { this._props = {}; }
  get display() { return this._props.display ?? ''; }
  set display(v) { this._props.display = v; }
  get left() { return this._props.left ?? ''; }
  set left(v) { this._props.left = v; }
  get top() { return this._props.top ?? ''; }
  set top(v) { this._props.top = v; }
  get transform() { return this._props.transform ?? ''; }
  set transform(v) { this._props.transform = v; }
}

class ClassList {
  constructor() { this._set = new Set(); }
  add(...cls) { cls.forEach((c) => this._set.add(c)); }
  remove(...cls) { cls.forEach((c) => this._set.delete(c)); }
  toggle(c, force) {
    if (force === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); }
    else { force ? this._set.add(c) : this._set.delete(c); }
  }
  contains(c) { return this._set.has(c); }
}

class Element {
  constructor(tag) {
    this.tagName = (tag || 'DIV').toUpperCase();
    this.children = [];
    this.className = '';
    this.id = '';
    this.textContent = '';
    this.title = '';
    this.dataset = {};
    this._innerHTML = '';
    this._listeners = {};
    this.style = new Style();
    this.classList = new ClassList();
    this.onclick = null;
  }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; }

  getAttribute(name) {
    if (name === 'class') return this.className;
    if (name === 'id') return this.id;
    return null;
  }

  setAttribute(name, value) {
    if (name === 'class') this.className = value;
    else if (name === 'id') this.id = value;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i > -1) this.children.splice(i, 1);
    return child;
  }

  remove() {}

  addEventListener(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
  }

  removeEventListener(event, handler) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter((h) => h !== handler);
    }
  }

  querySelector(sel) { return null; }
  querySelectorAll(sel) { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 30 }; }

  click() {}
}

class Document {
  constructor() {
    this._elements = {};
    this.body = new Element('BODY');
  }

  createElement(tag) {
    return new Element(tag);
  }

  createTextNode(text) {
    return { textContent: text, nodeType: 3 };
  }

  getElementById(id) {
    // Return a stub element — modules expect these to exist
    if (!this._elements[id]) {
      const el = new Element('DIV');
      el.id = id;
      this._elements[id] = el;
    }
    return this._elements[id];
  }

  querySelector(sel) {
    // Handle class selectors by returning a stub
    return new Element('DIV');
  }

  querySelectorAll(sel) {
    return [];
  }

  get documentElement() {
    return new Element('HTML');
  }
}

class Window {
  constructor(doc) {
    this.document = doc;
  }
}

export class JSDOM {
  constructor() {
    this.document = new Document();
    this.window = new Window(this.document);
  }
}
