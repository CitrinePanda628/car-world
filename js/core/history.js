class History {
   constructor(network, limit = 50) {
      this.network = network;
      this.limit = limit;
      this.undoStack = [];
      this.redoStack = [];
      this.suspended = false;
      this.lastSnapshot = null;
   }

   #serialize() {
      return JSON.stringify(this.network.toJSON());
   }

   #snapshot() {
      const snap = this.#serialize();
      return snap;
   }

   capture() {
      if (this.suspended) return;
      const snap = this.#snapshot();
      if (this.lastSnapshot === snap) return;
      this.undoStack.push(this.lastSnapshot ?? snap);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.lastSnapshot = snap;
      this.redoStack = [];
   }

   primeBaseline() {
      this.lastSnapshot = this.#snapshot();
   }

   undo() {
      if (this.undoStack.length === 0) return false;
      const current = this.#serialize();
      this.redoStack.push(current);
      const prev = this.undoStack.pop();
      this.suspended = true;
      try {
         this.network.loadJSON(JSON.parse(prev));
      } finally {
         this.suspended = false;
      }
      this.lastSnapshot = prev;
      return true;
   }

   redo() {
      if (this.redoStack.length === 0) return false;
      const current = this.#serialize();
      this.undoStack.push(current);
      const next = this.redoStack.pop();
      this.suspended = true;
      try {
         this.network.loadJSON(JSON.parse(next));
      } finally {
         this.suspended = false;
      }
      this.lastSnapshot = next;
      return true;
   }

   canUndo() { return this.undoStack.length > 0; }
   canRedo() { return this.redoStack.length > 0; }
}
