class Store {
  constructor(board = {}) {
    this.boardId = typeof board.id === 'string' && board.id.trim() ? board.id : 'Untitled';
    this.cards = Array.isArray(board.cards) ? board.cards.map((card) => ({ ...card })) : [];
    this.connections = Array.isArray(board.connections)
      ? board.connections.map((connection) => ({ ...connection }))
      : [];
    this.frames = Array.isArray(board.frames) ? board.frames.map((f) => ({ ...f })) : [];
    this.listeners = new Set();
    this._history = [];
    this._future = [];
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitChange() {
    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }

  _snapshot() {
    return {
      boardId: this.boardId,
      cards: this.cards.map((c) => ({ ...c })),
      connections: this.connections.map((c) => ({ ...c })),
      frames: this.frames.map((f) => ({ ...f, cards: Array.isArray(f.cards) ? [...f.cards] : [] })),
    };
  }

  _restore(snap) {
    this.boardId = snap.boardId;
    this.cards = snap.cards.map((c) => ({ ...c }));
    this.connections = snap.connections.map((c) => ({ ...c }));
    this.frames = snap.frames.map((f) => ({ ...f, cards: [...f.cards] }));
  }

  _commit(snap) {
    this._history.push(snap);
    if (this._history.length > 100) this._history.shift();
    this._future = [];
  }

  undo() {
    if (!this._history.length) return;
    this._future.push(this._snapshot());
    this._restore(this._history.pop());
    this.emitChange();
  }

  redo() {
    if (!this._future.length) return;
    this._history.push(this._snapshot());
    this._restore(this._future.pop());
    this.emitChange();
  }

  getState() {
    return {
      id: this.boardId,
      cards: this.cards.map((card) => ({ ...card })),
      connections: this.connections.map((connection) => ({ ...connection })),
      frames: this.frames.map((f) => ({ ...f })),
    };
  }

  setBoard(board) {
    this._history = [];
    this._future = [];
    this.boardId = typeof board.id === 'string' && board.id.trim() ? board.id : 'Untitled';
    this.cards = Array.isArray(board.cards) ? board.cards.map((card) => ({ ...card })) : [];
    this.connections = Array.isArray(board.connections)
      ? board.connections.map((connection) => ({ ...connection }))
      : [];
    this.frames = Array.isArray(board.frames) ? board.frames.map((f) => ({ ...f })) : [];
    this.emitChange();
  }

  addCard(text = '', parentId) {
    const snap = this._snapshot();
    const card = { id: `card-${this.nextCardNumber()}`, text };
    if (parentId) {
      const parent = this.cards.find((c) => c.id === parentId);
      if (parent && !parent.parentId) {
        card.parentId = parentId;
      }
    }
    this.cards.push(card);
    this._commit(snap);
    this.emitChange();
    return card;
  }

  updateCardText(cardId, text) {
    const snap = this._snapshot();
    let updated = false;
    this.cards = this.cards.map((card) => {
      if (card.id !== cardId) {
        return card;
      }

      updated = true;
      return { ...card, text };
    });

    if (updated) {
      this._commit(snap);
      this.emitChange();
    }
  }

  deleteCard(cardId) {
    const snap = this._snapshot();
    const originalCardCount = this.cards.length;
    const originalConnectionCount = this.connections.length;
    // Collect ids to delete: the card itself plus any children.
    const idsToDelete = new Set([cardId]);
    for (const card of this.cards) {
      if (card.parentId === cardId) idsToDelete.add(card.id);
    }
    this.cards = this.cards.filter((card) => !idsToDelete.has(card.id));
    this.connections = this.connections.filter(
      (connection) => !idsToDelete.has(connection.from) && !idsToDelete.has(connection.to),
    );
    this.frames = this.frames
      .map((f) => ({ ...f, cards: Array.isArray(f.cards) ? f.cards.filter((id) => !idsToDelete.has(id)) : [] }))
      .filter((f) => f.cards.length > 0);

    if (this.cards.length !== originalCardCount || this.connections.length !== originalConnectionCount) {
      this._commit(snap);
      this.emitChange();
    }
  }

  deleteCards(cardIds) {
    const snap = this._snapshot();
    const idsToDelete = new Set();
    for (const cardId of cardIds) {
      idsToDelete.add(cardId);
      for (const card of this.cards) {
        if (card.parentId === cardId) idsToDelete.add(card.id);
      }
    }
    const origCardCount = this.cards.length;
    const origConnCount = this.connections.length;
    this.cards = this.cards.filter((c) => !idsToDelete.has(c.id));
    this.connections = this.connections.filter(
      (conn) => !idsToDelete.has(conn.from) && !idsToDelete.has(conn.to),
    );
    this.frames = this.frames.map((f) => ({
      ...f,
      cards: Array.isArray(f.cards) ? f.cards.filter((id) => !idsToDelete.has(id)) : [],
    })).filter((f) => f.cards.length > 0);
    if (this.cards.length !== origCardCount || this.connections.length !== origConnCount) {
      this._commit(snap);
      this.emitChange();
    }
  }

  addConnection(from, to, label = '', scope) {
    if (from === to) {
      return null;
    }

    const snap = this._snapshot();
    const connection = { from, to };
    const trimmedLabel = typeof label === 'string' ? label.trim() : '';
    if (trimmedLabel) {
      connection.label = trimmedLabel;
    }
    if (scope) {
      connection.scope = scope;
    }

    this.connections.push(connection);
    this._commit(snap);
    this.emitChange();
    return connection;
  }

  updateConnectionLabel(index, label = '') {
    if (index < 0 || index >= this.connections.length) {
      return null;
    }

    const snap = this._snapshot();
    const trimmedLabel = typeof label === 'string' ? label.trim() : '';
    const connection = { ...this.connections[index] };
    if (trimmedLabel) {
      connection.label = trimmedLabel;
    } else {
      delete connection.label;
    }

    this.connections = this.connections.map((entry, entryIndex) => (entryIndex === index ? connection : entry));
    this._commit(snap);
    this.emitChange();
    return connection;
  }

  deleteConnection(index) {
    if (index < 0 || index >= this.connections.length) {
      return false;
    }

    const snap = this._snapshot();
    this.connections = this.connections.filter((_, entryIndex) => entryIndex !== index);
    this._commit(snap);
    this.emitChange();
    return true;
  }

  addFrame(text, cardIds, scope) {
    const snap = this._snapshot();
    const frame = { id: `frame-${this.nextFrameNumber()}`, text, cards: Array.isArray(cardIds) ? [...cardIds] : [] };
    if (scope) frame.scope = scope;
    this.frames.push(frame);
    this._commit(snap);
    this.emitChange();
    return frame;
  }

  updateFrameText(id, text) {
    const snap = this._snapshot();
    let updated = false;
    this.frames = this.frames.map((f) => {
      if (f.id !== id) return f;
      updated = true;
      return { ...f, text };
    });
    if (updated) {
      this._commit(snap);
      this.emitChange();
    }
  }

  updateFrameCards(id, cardIds) {
    const snap = this._snapshot();
    let updated = false;
    this.frames = this.frames.map((f) => {
      if (f.id !== id) return f;
      updated = true;
      return { ...f, cards: Array.isArray(cardIds) ? [...cardIds] : [] };
    });
    if (updated) {
      this._commit(snap);
      this.emitChange();
    }
  }

  deleteFrame(id) {
    const snap = this._snapshot();
    const originalCount = this.frames.length;
    this.frames = this.frames.filter((f) => f.id !== id);
    if (this.frames.length !== originalCount) {
      this._commit(snap);
      this.emitChange();
    }
  }

  nextFrameNumber() {
    let max = 0;
    for (const f of this.frames) {
      const match = /^frame-(\d+)$/.exec(f.id);
      if (!match) continue;
      max = Math.max(max, Number(match[1]));
    }
    return max + 1;
  }

  nextCardNumber() {
    let max = 0;
    for (const card of this.cards) {
      const match = /^card-(\d+)$/.exec(card.id);
      if (!match) {
        continue;
      }

      max = Math.max(max, Number(match[1]));
    }
    return max + 1;
  }
}

window.Store = Store;
window.boardStore = new Store({ id: 'Untitled', cards: [], connections: [] });
