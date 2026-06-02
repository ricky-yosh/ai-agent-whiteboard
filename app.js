const toolbar = document.getElementById('toolbar');
const boardName = document.getElementById('boardName');
const errorBanner = document.getElementById('errorBanner');
const newBoardButton = document.getElementById('newBoardButton');
const loadButton = document.getElementById('loadButton');
const layoutButton = document.getElementById('layoutButton');
const copyButton = document.getElementById('copyButton');
const downloadButton = document.getElementById('downloadButton');
const fileInput = document.getElementById('fileInput');
const board = document.getElementById('board');
const boardHint = document.getElementById('boardHint');
const boardSurface = document.getElementById('boardSurface');
const connectionDraft = document.getElementById('connectionDraft');
const connectionDraftLine = document.getElementById('connectionDraftLine');
const connectionPrompt = document.getElementById('connectionPrompt');
const connectionLabelInput = document.getElementById('connectionLabelInput');
const cardEditor = document.getElementById('cardEditor');
const canvas = document.getElementById('canvas');
const shortcutsOverlay = document.getElementById('shortcutsOverlay');
const shortcutsButton = document.getElementById('shortcutsButton');
const shortcutsClose = document.getElementById('shortcutsClose');
const marqueeRect = document.getElementById('marqueeRect');
const boardPath = document.getElementById('boardPath');
const boardPathSep = document.querySelector('.brand__sep--path');
const openFolderButton = document.getElementById('openFolderButton');
const store = window.boardStore;

const CARD_WIDTH = 220;
const CARD_HEIGHT = 96;
const CARD_MARGIN = 24;
const POSITION_STORAGE_PREFIX = 'whiteboard:positions';
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4.0;

// Catppuccin Mocha accent palette for frame/card tinting.
const FRAME_COLORS = [
  { r: 137, g: 180, b: 250 }, // blue
  { r: 148, g: 226, b: 213 }, // teal
  { r: 166, g: 227, b: 161 }, // green
  { r: 250, g: 179, b: 135 }, // peach
  { r: 203, g: 166, b: 247 }, // mauve
  { r: 245, g: 194, b: 231 }, // pink
  { r: 249, g: 226, b: 175 }, // yellow
  { r: 116, g: 199, b: 236 }, // sapphire
];

function frameColorForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffff;
  return FRAME_COLORS[hash % FRAME_COLORS.length];
}

function rgbToHsl(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t) => {
    const tt = ((t % 1) + 1) % 1;
    if (tt < 1/6) return p + (q - p) * 6 * tt;
    if (tt < 1/2) return q;
    if (tt < 2/3) return p + (q - p) * (2/3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(h + 1/3) * 255),
    g: Math.round(hue2rgb(h) * 255),
    b: Math.round(hue2rgb(h - 1/3) * 255),
  };
}

let activeEditor = null;
let activeConnectionGesture = null;
let activeConnectionPrompt = null;
let selectedItem = null;
let hoveredConnectionIndex = null;
let lastPointerDownCardId = null;
let lastPointerDownTime = 0;
let lastPointerDownFrameLabelId = null;
let lastPointerDownFrameLabelTime = 0;
let panX = 0;
let panY = 0;
let zoom = 1;
let currentScope = null;
let rootViewSnapshot = null;
let spaceDown = false;

const canvasLayer = document.createElement('div');
canvasLayer.className = 'canvas__layer';
boardSurface.appendChild(canvasLayer);
canvasLayer.appendChild(boardHint);

// Capture-phase frame handler: fires before card/connection handlers so clicks anywhere
// inside a frame — including on top of cards — can select or drag the frame.
let _pendingFrameClick = null; // { id, x, y } — resolved to selectFrame on pointerup if click

canvasLayer.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  _pendingFrameClick = null;

  const boardRect = boardSurface.getBoundingClientRect();
  const clickX = (event.clientX - boardRect.left - panX) / zoom;
  const clickY = (event.clientY - boardRect.top - panY) / zoom;

  // Find the topmost frame that contains this click.
  // Check DOM first for label clicks (label overflows above the frame's coordinate box).
  let hitFrameEl = event.target.closest('.frame') || null;
  if (!hitFrameEl) {
    for (const frameEl of canvasLayer.querySelectorAll('.frame')) {
      const fLeft = parseFloat(frameEl.style.left) || 0;
      const fTop = parseFloat(frameEl.style.top) || 0;
      const fRight = fLeft + (parseFloat(frameEl.style.width) || 0);
      const fBottom = fTop + (parseFloat(frameEl.style.height) || 0);
      if (clickX >= fLeft && clickX <= fRight && clickY >= fTop && clickY <= fBottom) {
        hitFrameEl = frameEl;
      }
    }
  }
  if (!hitFrameEl) return;

  const frameId = hitFrameEl.dataset.frameId;

  // Double-click detection.
  const now = Date.now();
  const isDoubleClick = frameId === lastPointerDownFrameLabelId && now - lastPointerDownFrameLabelTime < 300;
  lastPointerDownFrameLabelId = frameId;
  lastPointerDownFrameLabelTime = now;

  if (isDoubleClick) {
    if (event.target.closest('.frame__label')) {
      event.preventDefault();
      event.stopPropagation();
      openFrameLabelEditor(hitFrameEl, frameId);
    }
    // Double-click on frame body: fall through so boardSurface creates a card.
    return;
  }

  const alreadySelected = selectedItem && selectedItem.type === 'frame' && selectedItem.id === frameId;
  if (!alreadySelected) {
    // Not yet selected. Let card/connection events pass through normally.
    if (event.target.closest('.card') || event.target.closest('.connection')) return;
    // Background click or drag: don't stop propagation so marquee can start.
    // Record the start point — if the pointer barely moves we treat it as a click and select the frame.
    _pendingFrameClick = { id: frameId, x: event.clientX, y: event.clientY };
    return;
  }

  // Frame already selected: let card/connection clicks through normally.
  // Clicks on the frame background (not a card/connection) start a drag.
  if (event.target.closest('.card') || event.target.closest('.connection')) return;

  event.stopPropagation();
  const frameData = store.getState().frames.find((f) => f.id === frameId);
  if (frameData) beginFrameDragMembers(hitFrameEl, frameData, event.pointerId, event.clientX, event.clientY);
}, { capture: true });

canvasLayer.addEventListener('pointerup', (event) => {
  if (!_pendingFrameClick) return;
  const { id, x, y } = _pendingFrameClick;
  _pendingFrameClick = null;
  const dist = Math.hypot(event.clientX - x, event.clientY - y);
  // Defer past boardSurface's finish() handler, which calls clearSelection() on no-drag pointerup.
  if (dist < 6) setTimeout(() => selectFrame(id), 0);
}, { capture: true });

function applyViewport() {
  canvasLayer.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
  let baseGrid = 24;
  while (baseGrid * zoom < 16) baseGrid *= 2;
  while (baseGrid * zoom > 48) baseGrid /= 2;
  const gridSize = baseGrid * zoom;
  boardSurface.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  boardSurface.style.backgroundPosition = `${((panX % gridSize) + gridSize) % gridSize}px ${((panY % gridSize) + gridSize) % gridSize}px`;
  positionEditor();
  positionConnectionPrompt();
  positionConnectionDraft();
}

function openFilePicker() {
  fileInput.value = '';
  fileInput.click();
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.removeAttribute('hidden');
  requestAnimationFrame(() => errorBanner.classList.add('is-visible'));
}

function clearError() {
  errorBanner.classList.remove('is-visible');
  setTimeout(() => errorBanner.setAttribute('hidden', ''), 180);
}

function serializeBoard(state) {
  return JSON.stringify(
    {
      id: state.id,
      cards: state.cards.map((card) => {
        const serialized = { id: card.id, text: card.text };
        if (card.parentId) serialized.parentId = card.parentId;
        return serialized;
      }),
      connections: state.connections.map((connection) => {
        const serialized = { from: connection.from, to: connection.to };
        if (typeof connection.label === 'string' && connection.label.trim()) {
          serialized.label = connection.label.trim();
        }
        if (connection.scope) serialized.scope = connection.scope;
        return serialized;
      }),
      frames: state.frames.map((f) => {
        const sf = { id: f.id, text: f.text, cards: Array.isArray(f.cards) ? [...f.cards] : [] };
        if (f.scope) sf.scope = f.scope;
        return sf;
      }),
    },
    null,
    2,
  );
}

function sanitizeFileName(name) {
  return String(name || 'board')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-');
}

async function copyBoardJson() {
  const json = serializeBoard(store.getState());
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(json);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = json;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) {
    throw new Error('Clipboard copy failed.');
  }
}

function downloadBoardJson() {
  const json = serializeBoard(store.getState());
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${sanitizeFileName(store.getState().id)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function centerOnOrigin() {
  const rect = board.getBoundingClientRect();
  panX = rect.width / 2;
  panY = rect.height / 2;
  applyViewport();
}

const breadcrumb = document.getElementById('breadcrumb');
const breadcrumbBack = document.getElementById('breadcrumbBack');
const breadcrumbCurrent = document.getElementById('breadcrumbCurrent');

function updateBreadcrumb() {
  if (currentScope === null) {
    breadcrumb.hidden = true;
    return;
  }
  const card = store.getState().cards.find((c) => c.id === currentScope);
  const text = card ? card.text : currentScope;
  breadcrumbCurrent.textContent = text.length > 24 ? text.slice(0, 24) + '…' : text;
  breadcrumb.hidden = false;
}

let _scopeTransitionTimer = null;

function enterScope(cardId) {
  if (currentScope !== null) return;
  rootViewSnapshot = { panX, panY, zoom };
  currentScope = cardId;
  const rect = board.getBoundingClientRect();
  panX = rect.width / 2;
  panY = rect.height / 2;
  zoom = 1;
  board.classList.add('board--in-scope');
  canvasLayer.style.transition = 'opacity 150ms ease-in';
  canvasLayer.style.opacity = '0';
  clearTimeout(_scopeTransitionTimer);
  _scopeTransitionTimer = setTimeout(() => {
    renderBoard(store.getState());
    applyViewport();
    canvasLayer.style.transition = 'opacity 220ms ease-out';
    canvasLayer.style.opacity = '1';
    updateBreadcrumb();
  }, 150);
}

function exitScope() {
  if (currentScope === null) return;
  currentScope = null;
  if (rootViewSnapshot) {
    panX = rootViewSnapshot.panX;
    panY = rootViewSnapshot.panY;
    zoom = rootViewSnapshot.zoom;
    rootViewSnapshot = null;
  }
  board.classList.remove('board--in-scope');
  canvasLayer.style.transition = 'opacity 150ms ease-in';
  canvasLayer.style.opacity = '0';
  clearTimeout(_scopeTransitionTimer);
  _scopeTransitionTimer = setTimeout(() => {
    applyViewport();
    renderBoard(store.getState());
    canvasLayer.style.transition = 'opacity 220ms ease-out';
    canvasLayer.style.opacity = '1';
    updateBreadcrumb();
  }, 150);
}

function flashCard(cardId) {
  const el = canvasLayer.querySelector(`[data-card-id="${cardId}"]`);
  if (!el) return;
  el.classList.add('card--flash');
  setTimeout(() => el.classList.remove('card--flash'), 500);
}

function showBoard(name) {
  boardName.textContent = name;
  board.classList.add('is-visible');
  toolbar.classList.remove('is-hidden');
  centerOnOrigin();
  showJsonMinimap();
}

function showBlankCanvas() {
  board.classList.add('is-visible');
  toolbar.classList.remove('is-hidden');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(max, min));
}

function getCardState(cardId) {
  return store.getState().cards.find((card) => card.id === cardId) || null;
}

function getCardElement(cardId) {
  return boardSurface.querySelector(`.card[data-card-id="${cardId}"]`);
}


function getPointerCardId(event) {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  const cardElement = element && typeof element.closest === 'function' ? element.closest('.card') : null;
  return cardElement && cardElement.dataset.cardId ? cardElement.dataset.cardId : null;
}

function resizeEditorToContent() {
  if (!activeEditor) {
    return;
  }

  cardEditor.style.height = 'auto';
  cardEditor.style.height = `${Math.max(cardEditor.scrollHeight, CARD_HEIGHT)}px`;
}

function positionEditor() {
  if (!activeEditor) {
    return;
  }

  const cardElement = getCardElement(activeEditor.cardId);
  if (!cardElement) {
    closeEditor();
    return;
  }

  const canvasLeft = Number.parseFloat(cardElement.style.left) || 0;
  const canvasTop = Number.parseFloat(cardElement.style.top) || 0;
  const width = cardElement.offsetWidth || CARD_WIDTH;
  const height = cardElement.offsetHeight || CARD_HEIGHT;

  cardEditor.classList.add('is-visible');
  cardEditor.style.left = `${canvasLeft * zoom + panX}px`;
  cardEditor.style.top = `${canvasTop * zoom + panY}px`;
  cardEditor.style.width = `${width}px`;
  cardEditor.style.minHeight = `${height}px`;
  cardEditor.style.transform = `scale(${zoom})`;
  cardEditor.style.transformOrigin = 'top left';
  resizeEditorToContent();
}

function openEditor(cardId, options = {}) {
  const card = getCardState(cardId);
  if (!card) {
    return;
  }

  if (activeEditor && activeEditor.cardId === cardId) {
    positionEditor();
    cardEditor.focus();
    return;
  }

  closeEditor();
  activeEditor = {
    cardId,
    isNewCard: Boolean(options.isNewCard),
    originalText: card.text,
  };
  cardEditor.value = card.text;
  positionEditor();
  cardEditor.focus();
  cardEditor.setSelectionRange(cardEditor.value.length, cardEditor.value.length);
}

function clearSelection() {
  selectedItem = null;
  for (const element of boardSurface.querySelectorAll('.card.is-selected, .connection.is-selected, .frame.is-selected')) {
    element.classList.remove('is-selected');
  }
}

function selectFrame(id) {
  selectedItem = { type: 'frame', id };
  syncSelection();
}

function selectCard(cardId) {
  selectedItem = { type: 'card', id: cardId };
  syncSelection();
}

function selectConnection(index) {
  const state = store.getState();
  const connection = state.connections[index];
  if (!connection) {
    selectedItem = null;
    syncSelection();
    return;
  }

  const signature = {
    from: connection.from,
    to: connection.to,
    label: typeof connection.label === 'string' ? connection.label.trim() : '',
    occurrence: 0,
  };

  for (let i = 0; i <= index; i += 1) {
    const candidate = state.connections[i];
    if (!candidate) {
      continue;
    }

    const candidateLabel = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    if (
      candidate.from === signature.from &&
      candidate.to === signature.to &&
      candidateLabel === signature.label
    ) {
      signature.occurrence += 1;
    }
  }

  selectedItem = { type: 'connection', index, signature };
  syncSelection();
}

function selectCards(ids) {
  selectedItem = { type: 'cards', ids };
  syncSelection();
}

function toggleCardInSelection(cardId) {
  if (!selectedItem || selectedItem.type === 'connection') {
    selectCard(cardId);
    return;
  }

  const currentIds = selectedItem.type === 'cards' ? selectedItem.ids : [selectedItem.id];
  if (currentIds.includes(cardId)) {
    const remaining = currentIds.filter((id) => id !== cardId);
    if (remaining.length === 0) {
      clearSelection();
    } else if (remaining.length === 1) {
      selectCard(remaining[0]);
    } else {
      selectCards(remaining);
    }
  } else {
    selectCards([...currentIds, cardId]);
  }
}

function resolveSelectedConnectionIndex(state) {
  if (!selectedItem || selectedItem.type !== 'connection') {
    return null;
  }

  const { index, signature } = selectedItem;
  const current = state.connections[index];
  if (current) {
    const currentLabel = typeof current.label === 'string' ? current.label.trim() : '';
    if (
      current.from === signature.from &&
      current.to === signature.to &&
      currentLabel === signature.label
    ) {
      return index;
    }
  }

  let occurrence = 0;
  for (let i = 0; i < state.connections.length; i += 1) {
    const connection = state.connections[i];
    const connectionLabel = typeof connection.label === 'string' ? connection.label.trim() : '';
    if (
      connection.from === signature.from &&
      connection.to === signature.to &&
      connectionLabel === signature.label
    ) {
      occurrence += 1;
      if (occurrence === signature.occurrence) {
        return i;
      }
    }
  }

  return null;
}

function syncSelection() {
  if (selectedItem && selectedItem.type === 'card' && !getCardElement(selectedItem.id)) {
    selectedItem = null;
  }

  if (selectedItem && selectedItem.type === 'cards') {
    selectedItem.ids = selectedItem.ids.filter((id) => getCardElement(id));
    if (selectedItem.ids.length === 0) selectedItem = null;
  }

  const state = store.getState();
  const selectedConnectionIndex = resolveSelectedConnectionIndex(state);
  if (selectedItem && selectedItem.type === 'connection' && selectedConnectionIndex === null) {
    selectedItem = null;
  }

  if (selectedItem && selectedItem.type === 'frame') {
    const frameEl = boardSurface.querySelector(`.frame[data-frame-id="${selectedItem.id}"]`);
    if (!frameEl) selectedItem = null;
  }

  const selectedCardId = selectedItem && selectedItem.type === 'card' ? selectedItem.id : null;
  const selectedCardIds = selectedItem && selectedItem.type === 'cards' ? new Set(selectedItem.ids) : null;
  const selectedFrameId = selectedItem && selectedItem.type === 'frame' ? selectedItem.id : null;

  for (const cardElement of boardSurface.querySelectorAll('.card')) {
    const id = cardElement.dataset.cardId;
    const isSelected =
      (selectedCardId && id === selectedCardId) ||
      (selectedCardIds && selectedCardIds.has(id));
    cardElement.classList.toggle('is-selected', Boolean(isSelected));
  }

  for (const connectionElement of boardSurface.querySelectorAll('.connection')) {
    connectionElement.classList.toggle(
      'is-selected',
      Boolean(
        selectedConnectionIndex !== null &&
        Number.parseInt(connectionElement.dataset.connectionIndex, 10) === selectedConnectionIndex,
      ),
    );
  }

  for (const frameElement of boardSurface.querySelectorAll('.frame')) {
    frameElement.classList.toggle('is-selected', frameElement.dataset.frameId === selectedFrameId);
  }
}

function hideConnectionPrompt() {
  connectionPrompt.classList.remove('is-visible');
  connectionPrompt.classList.remove('is-editing');
  connectionPrompt.style.left = '';
  connectionPrompt.style.top = '';
  connectionLabelInput.value = '';
  activeConnectionPrompt = null;
  connectionLabelInput.blur();
}

function hideConnectionDraft() {
  connectionDraftLine.removeAttribute('x1');
  connectionDraftLine.removeAttribute('y1');
  connectionDraftLine.removeAttribute('x2');
  connectionDraftLine.removeAttribute('y2');
}

function cancelConnectionGesture() {
  if (activeConnectionGesture && activeConnectionGesture.sourceElement) {
    activeConnectionGesture.sourceElement.classList.remove('is-connection-source');
  }
  activeConnectionGesture = null;
  hideConnectionPrompt();
  hideConnectionDraft();
  connectionDraft.classList.remove('is-visible');
}

function showConnectionPrompt(canvasX, canvasY, promptState = {}, value = '') {
  activeConnectionPrompt = { ...promptState, canvasX, canvasY };
  connectionPrompt.style.left = `${canvasX * zoom + panX}px`;
  connectionPrompt.style.top = `${canvasY * zoom + panY}px`;
  connectionPrompt.classList.add('is-visible');
  connectionPrompt.classList.toggle('is-editing', promptState.mode === 'edit');
  connectionLabelInput.value = value;
  requestAnimationFrame(() => {
    connectionLabelInput.focus();
    connectionLabelInput.select();
  });
}

function positionConnectionPrompt() {
  if (!activeConnectionPrompt) return;
  connectionPrompt.style.left = `${activeConnectionPrompt.canvasX * zoom + panX}px`;
  connectionPrompt.style.top = `${activeConnectionPrompt.canvasY * zoom + panY}px`;
}

function positionConnectionDraft() {
  if (!activeConnectionGesture) return;
  const fromEl = getCardElement(activeConnectionGesture.fromCardId);
  if (!fromEl) return;
  const fromBox = getCardBox(fromEl);
  const toCardId = activeConnectionGesture.toCardId;
  if (toCardId && toCardId !== activeConnectionGesture.fromCardId) {
    const toEl = getCardElement(toCardId);
    if (toEl) {
      const toBox = getCardBox(toEl);
      const { x1, y1, x2, y2 } = getConnectionEndpoints(fromBox, toBox);
      connectionDraftLine.setAttribute('d', bezierPath(
        x1 * zoom + panX, y1 * zoom + panY,
        x2 * zoom + panX, y2 * zoom + panY,
      ));
    }
  }
}

function commitConnectionPrompt(label = '') {
  if (!activeConnectionPrompt) {
    return;
  }

  const promptState = activeConnectionPrompt;
  hideConnectionPrompt();

  if (promptState.mode === 'edit') {
    store.updateConnectionLabel(promptState.connectionIndex, label);
    return;
  }

  if (!activeConnectionGesture) {
    return;
  }

  const { fromCardId, toCardId } = activeConnectionGesture;
  // Cross-scope check: both cards must belong to the same scope.
  const allCards = store.getState().cards;
  const fromCard = allCards.find((c) => c.id === fromCardId);
  const toCard = allCards.find((c) => c.id === toCardId);
  const fromParent = fromCard ? (fromCard.parentId || null) : null;
  const toParent = toCard ? (toCard.parentId || null) : null;
  if (fromParent !== toParent) {
    cancelConnectionGesture();
    flashCard(fromCardId);
    return;
  }
  cancelConnectionGesture();
  store.addConnection(fromCardId, toCardId, label, currentScope || undefined);
}

function cancelConnectionPrompt() {
  hideConnectionPrompt();
  cancelConnectionGesture();
}

function closeEditor(save = true) {
  if (!activeEditor) {
    return;
  }

  const editor = activeEditor;
  const nextText = cardEditor.value;
  activeEditor = null;
  if (document.activeElement === cardEditor) {
    cardEditor.blur();
  }
  cardEditor.classList.remove('is-visible');
  cardEditor.value = '';
  cardEditor.style.left = '';
  cardEditor.style.top = '';
  cardEditor.style.width = '';
  cardEditor.style.minHeight = '';
  cardEditor.style.transform = '';
  cardEditor.style.transformOrigin = '';

  if (!save) return;
  if (editor.isNewCard && !nextText.trim()) {
    store.deleteCard(editor.cardId);
    return;
  }
  if (nextText !== editor.originalText) {
    store.updateCardText(editor.cardId, nextText);
  }
}

function boardPositionKey(boardId) {
  return `${POSITION_STORAGE_PREFIX}:${boardId}`;
}

function readStoredPositions(boardId) {
  try {
    const raw = localStorage.getItem(boardPositionKey(boardId));
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function writeStoredPositions(boardId, positions) {
  try {
    localStorage.setItem(boardPositionKey(boardId), JSON.stringify(positions));
  } catch {
    // Ignore storage failures in unsupported browser modes.
  }
}

function setStoredPosition(boardId, cardId, x, y) {
  const positions = readStoredPositions(boardId);
  positions[cardId] = { x, y };
  writeStoredPositions(boardId, positions);
}

function getBoardBounds() {
  const bounds = boardSurface.getBoundingClientRect();
  return {
    width: Math.max(bounds.width, CARD_WIDTH + CARD_MARGIN * 2 + 1),
    height: Math.max(bounds.height, CARD_HEIGHT + CARD_MARGIN * 2 + 1),
  };
}

function getCardBox(cardElement) {
  const left = Number.parseFloat(cardElement.dataset.left || cardElement.style.left) || 0;
  const top = Number.parseFloat(cardElement.dataset.top || cardElement.style.top) || 0;
  const width = cardElement.offsetWidth || CARD_WIDTH;
  const height = cardElement.offsetHeight || CARD_HEIGHT;
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function getCardBoxesById() {
  const boxes = new Map();
  for (const cardElement of boardSurface.querySelectorAll('.card')) {
    if (!cardElement.dataset.cardId) {
      continue;
    }

    boxes.set(cardElement.dataset.cardId, getCardBox(cardElement));
  }

  return boxes;
}

function bezierPath(x1, y1, x2, y2, lateralOffset = 0) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * lateralOffset;
  const py = (dx / len) * lateralOffset;
  const t = 0.4;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return `M ${x1},${y1} C ${x1 + dx * t + px},${y1 + py} ${x2 - dx * t + px},${y2 + py} ${x2},${y2}`;
  }
  return `M ${x1},${y1} C ${x1 + px},${y1 + dy * t + py} ${x2 + px},${y2 - dy * t + py} ${x2},${y2}`;
}

function getConnectionEndpoints(fromBox, toBox) {
  const dx = toBox.centerX - fromBox.centerX;
  const dy = toBox.centerY - fromBox.centerY;
  if (dx === 0 && dy === 0) {
    return {
      x1: fromBox.centerX,
      y1: fromBox.centerY,
      x2: toBox.centerX,
      y2: toBox.centerY,
    };
  }

  const fromScale = 0.5 / Math.max(Math.abs(dx) / fromBox.width, Math.abs(dy) / fromBox.height);
  const toScale = 0.5 / Math.max(Math.abs(dx) / toBox.width, Math.abs(dy) / toBox.height);

  return {
    x1: fromBox.centerX + dx * fromScale,
    y1: fromBox.centerY + dy * fromScale,
    x2: toBox.centerX - dx * toScale,
    y2: toBox.centerY - dy * toScale,
  };
}

function getEdgePoint(box, toCanvasX, toCanvasY) {
  const dx = toCanvasX - box.centerX;
  const dy = toCanvasY - box.centerY;
  if (dx === 0 && dy === 0) return { x: box.centerX, y: box.centerY };
  const scale = 0.5 / Math.max(Math.abs(dx) / box.width, Math.abs(dy) / box.height);
  return { x: box.centerX + dx * scale, y: box.centerY + dy * scale };
}

function updateConnectionLayer(state) {
  const svg = boardSurface.querySelector('.board__connections');
  if (!svg) {
    return;
  }

  const boxesById = getCardBoxesById();
  const groupMap = new Map();
  svg.querySelectorAll('[data-connection-index]').forEach((g) => {
    groupMap.set(Number(g.dataset.connectionIndex), g);
  });

  // Group visible connections by unordered card pair so parallels can be spread apart.
  // Only include connections that have DOM groups; out-of-scope connections must not
  // affect lateral offsets for the current view.
  const channelMap = new Map();
  state.connections.forEach((connection, index) => {
    if (!groupMap.has(index)) return;
    const key = [connection.from, connection.to].sort().join('\0');
    if (!channelMap.has(key)) channelMap.set(key, []);
    channelMap.get(key).push(index);
  });
  const lateralOffsets = new Array(state.connections.length).fill(0);
  const PARALLEL_STEP = 38;
  for (const indices of channelMap.values()) {
    if (indices.length < 2) continue;
    indices.forEach((idx, i) => {
      lateralOffsets[idx] = (i - (indices.length - 1) / 2) * PARALLEL_STEP;
    });
  }

  state.connections.forEach((connection, index) => {
    const group = groupMap.get(index);
    if (!group) {
      return;
    }

    const fromBox = boxesById.get(connection.from);
    const toBox = boxesById.get(connection.to);
    if (!fromBox || !toBox) {
      group.setAttribute('visibility', 'hidden');
      return;
    }

    const hitPath = group.querySelector('.connection__hit');
    const line = group.querySelector('.connection__line');
    const label = group.querySelector('.connection__label');
    const { x1, y1, x2, y2 } = getConnectionEndpoints(fromBox, toBox);
    const isReversed = connection.from !== [connection.from, connection.to].sort()[0];
    const lateral = (isReversed ? -1 : 1) * lateralOffsets[index];

    // Perpendicular unit vector for label positioning (matches bezierPath's offset direction).
    const edgeDx = x2 - x1;
    const edgeDy = y2 - y1;
    const edgeLen = Math.hypot(edgeDx, edgeDy) || 1;
    const perpX = -edgeDy / edgeLen;
    const perpY = edgeDx / edgeLen;

    // Bezier midpoint shifts by 0.75 * lateral in the perp direction.
    const midX = (x1 + x2) / 2 + perpX * lateral * 0.75;
    const midY = (y1 + y2) / 2 + perpY * lateral * 0.75;
    const labelOffset = 14;

    group.removeAttribute('visibility');
    if (hitPath) hitPath.setAttribute('d', bezierPath(x1, y1, x2, y2, lateral));
    line.setAttribute('d', bezierPath(x1, y1, x2, y2, lateral));

    if (label) {
      label.setAttribute('x', midX + perpX * labelOffset);
      label.setAttribute('y', midY + perpY * labelOffset);
    }
  });
}

function createSeedPosition(index, bounds) {
  const centerX = bounds.width / 2 - CARD_WIDTH / 2;
  const centerY = bounds.height / 2 - CARD_HEIGHT / 2;
  const angle = index * 2.399963229728653;
  const ring = Math.min(bounds.width, bounds.height) * 0.18 + Math.floor(index / 6) * 44;
  return {
    x: clamp(centerX + Math.cos(angle) * ring, CARD_MARGIN, bounds.width - CARD_WIDTH - CARD_MARGIN),
    y: clamp(centerY + Math.sin(angle) * ring, CARD_MARGIN, bounds.height - CARD_HEIGHT - CARD_MARGIN),
  };
}

function runForceLayout(cards, connections, savedPositions, frames = []) {
  const viewBounds = getBoardBounds();
  const gridSize = Math.ceil(Math.sqrt(cards.length));
  const bounds = {
    width: Math.max(viewBounds.width, gridSize * 400),
    height: Math.max(viewBounds.height, gridSize * 300),
  };
  const nodes = cards.map((card, index) => {
    const saved = savedPositions[card.id];
    const seed = saved || createSeedPosition(index, bounds);
    return {
      card,
      x: seed.x,
      y: seed.y,
      vx: 0,
      vy: 0,
      fixed: Boolean(saved),
    };
  });

  const nodesById = new Map(nodes.map((node) => [node.card.id, node]));

  // Estimate each card's rendered height from its text so collision boxes are accurate.
  // At max-width 300px with 14px font: ~34 chars/line, ~21px/line, 54px base (padding + id row).
  // Estimate rendered height: ~28 chars/line at 300px max-width (14–16px font), ~24px/line.
  // Base 60px covers top padding + card-id row + bottom padding.
  const estHeights = new Map(nodes.map((n) => {
    const text = n.card.text || '';
    const lines = text.split('\n');
    const totalLines = lines.reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / 28)), 0);
    return [n.card.id, Math.max(CARD_HEIGHT, 60 + totalLines * 24)];
  }));

  for (let tick = 0; tick < 200; tick += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const left = nodes[i];
        const right = nodes[j];
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distance = Math.max(Math.hypot(dx, dy), 0.01);
        const force = 20000 / (distance * distance);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;

        if (!left.fixed) {
          left.vx -= fx;
          left.vy -= fy;
        }

        if (!right.fixed) {
          right.vx += fx;
          right.vy += fy;
        }
      }
    }

    for (const connection of connections) {
      const from = nodesById.get(connection.from);
      const to = nodesById.get(connection.to);
      if (!from || !to) {
        continue;
      }

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(Math.hypot(dx, dy), 0.01);
      const targetDistance = connection.label ? 580 : 460;
      const force = (distance - targetDistance) * 0.012;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;

      if (!from.fixed) {
        from.vx += fx;
        from.vy += fy;
      }

      if (!to.fixed) {
        to.vx -= fx;
        to.vy -= fy;
      }
    }

    // Intra-frame centroid attraction: pull each frame's cards toward their shared center.
    for (const frame of frames) {
      const members = (Array.isArray(frame.cards) ? frame.cards : [])
        .map((id) => nodesById.get(id)).filter(Boolean).filter((n) => !n.fixed);
      if (members.length < 2) continue;
      const cx = members.reduce((s, n) => s + n.x, 0) / members.length;
      const cy = members.reduce((s, n) => s + n.y, 0) / members.length;
      for (const n of members) {
        n.vx += (cx - n.x) * 0.003;
        n.vy += (cy - n.y) * 0.003;
      }
    }

    for (const node of nodes) {
      if (node.fixed) {
        continue;
      }

      node.vx += (bounds.width / 2 - node.x - CARD_WIDTH / 2) * 0.0005;
      node.vy += (bounds.height / 2 - node.y - CARD_HEIGHT / 2) * 0.0005;
      node.vx *= 0.86;
      node.vy *= 0.86;
      node.x += node.vx;
      node.y += node.vy;
      node.x = clamp(node.x, CARD_MARGIN, bounds.width - CARD_WIDTH - CARD_MARGIN);
      node.y = clamp(node.y, CARD_MARGIN, bounds.height - CARD_HEIGHT - CARD_MARGIN);
    }

    // AABB collision resolution: directly separate overlapping nodes.
    // Runs 3 passes per tick to handle cascading overlaps.
    const GAP = CARD_MARGIN * 3;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          if (a.fixed && b.fixed) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const colW = 300 + GAP;
          // Use height of whichever card is on top: that card's bottom edge is what B must clear.
          const colH = (dy >= 0 ? estHeights.get(a.card.id) : estHeights.get(b.card.id)) + GAP;
          const overlapX = colW - Math.abs(dx);
          const overlapY = colH - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) continue;
          const bothFree = !a.fixed && !b.fixed;
          if (overlapX < overlapY) {
            const sep = overlapX * (bothFree ? 0.5 : 1);
            const dir = dx >= 0 ? 1 : -1;
            if (!a.fixed) { a.x -= sep * dir; a.x = clamp(a.x, CARD_MARGIN, bounds.width - CARD_WIDTH - CARD_MARGIN); }
            if (!b.fixed) { b.x += sep * dir; b.x = clamp(b.x, CARD_MARGIN, bounds.width - CARD_WIDTH - CARD_MARGIN); }
          } else {
            const sep = overlapY * (bothFree ? 0.5 : 1);
            const dir = dy >= 0 ? 1 : -1;
            if (!a.fixed) { a.y -= sep * dir; a.y = clamp(a.y, CARD_MARGIN, bounds.height - CARD_HEIGHT - CARD_MARGIN); }
            if (!b.fixed) { b.y += sep * dir; b.y = clamp(b.y, CARD_MARGIN, bounds.height - CARD_HEIGHT - CARD_MARGIN); }
          }
        }
      }
    }

    // Frame-level AABB collision: treat each frame's bounding box as a rigid body
    // and push overlapping frames apart by moving all their member cards together.
    const FRAME_SEP = CARD_MARGIN * 5;
    const frameBoxes = [];
    for (const frame of frames) {
      const members = (Array.isArray(frame.cards) ? frame.cards : [])
        .map((id) => nodesById.get(id)).filter(Boolean);
      if (members.length === 0) continue;
      const free = members.filter((n) => !n.fixed);
      if (free.length === 0) continue;
      frameBoxes.push({
        minX: Math.min(...members.map((n) => n.x)) - FRAME_SEP,
        minY: Math.min(...members.map((n) => n.y)) - FRAME_SEP,
        maxX: Math.max(...members.map((n) => n.x + 300)) + FRAME_SEP,
        maxY: Math.max(...members.map((n) => n.y + (estHeights.get(n.card.id) || CARD_HEIGHT))) + FRAME_SEP,
        free,
      });
    }
    for (let i = 0; i < frameBoxes.length; i++) {
      for (let j = i + 1; j < frameBoxes.length; j++) {
        const a = frameBoxes[i];
        const b = frameBoxes[j];
        const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const cax = (a.minX + a.maxX) / 2;
        const cay = (a.minY + a.maxY) / 2;
        const cbx = (b.minX + b.maxX) / 2;
        const cby = (b.minY + b.maxY) / 2;
        if (overlapX < overlapY) {
          const sep = overlapX * 0.5;
          const dir = cbx >= cax ? 1 : -1;
          for (const n of a.free) { n.x -= sep * dir; n.x = clamp(n.x, CARD_MARGIN, bounds.width - CARD_WIDTH - CARD_MARGIN); }
          for (const n of b.free) { n.x += sep * dir; n.x = clamp(n.x, CARD_MARGIN, bounds.width - CARD_WIDTH - CARD_MARGIN); }
        } else {
          const sep = overlapY * 0.5;
          const dir = cby >= cay ? 1 : -1;
          for (const n of a.free) { n.y -= sep * dir; n.y = clamp(n.y, CARD_MARGIN, bounds.height - CARD_HEIGHT - CARD_MARGIN); }
          for (const n of b.free) { n.y += sep * dir; n.y = clamp(n.y, CARD_MARGIN, bounds.height - CARD_HEIGHT - CARD_MARGIN); }
        }
      }
    }
  }

  // Post-simulation overlap cleanup: no forces, pure constraint resolution.
  // Runs until every card pair is separated or 40 passes are exhausted.
  const POST_GAP = CARD_MARGIN * 2;
  for (let pass = 0; pass < 40; pass++) {
    let anyOverlap = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (a.fixed && b.fixed) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const colW = 300 + POST_GAP;
        const colH = (dy >= 0 ? estHeights.get(a.card.id) : estHeights.get(b.card.id)) + POST_GAP;
        const overlapX = colW - Math.abs(dx);
        const overlapY = colH - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        anyOverlap = true;
        const bothFree = !a.fixed && !b.fixed;
        if (overlapX < overlapY) {
          const sep = overlapX * (bothFree ? 0.5 : 1);
          const dir = dx >= 0 ? 1 : -1;
          if (!a.fixed) a.x -= sep * dir;
          if (!b.fixed) b.x += sep * dir;
        } else {
          const sep = overlapY * (bothFree ? 0.5 : 1);
          const dir = dy >= 0 ? 1 : -1;
          if (!a.fixed) a.y -= sep * dir;
          if (!b.fixed) b.y += sep * dir;
        }
      }
    }
    if (!anyOverlap) break;
  }

  const positions = {};
  for (const node of nodes) {
    positions[node.card.id] = {
      x: node.x,
      y: node.y,
    };
  }

  return positions;
}

function getBoardPositions(state) {
  const storedPositions = readStoredPositions(state.id);
  const knownCardIds = new Set(state.cards.map((card) => card.id));
  const filteredPositions = {};

  for (const [cardId, position] of Object.entries(storedPositions)) {
    if (
      knownCardIds.has(cardId) &&
      position &&
      typeof position.x === 'number' &&
      typeof position.y === 'number'
    ) {
      filteredPositions[cardId] = position;
    }
  }

  const missingCards = state.cards.some((card) => !filteredPositions[card.id]);
  if (missingCards) {
    const laidOutPositions = runForceLayout(state.cards, state.connections, filteredPositions, state.frames || []);
    writeStoredPositions(state.id, { ...storedPositions, ...laidOutPositions });
    return laidOutPositions;
  }

  return filteredPositions;
}

const FRAME_PAD = 20;

function updateFramesDuringDrag(cardId, includeCard) {
  const currentState = store.getState();
  for (const frame of currentState.frames) {
    const frameEl = boardSurface.querySelector(`.frame[data-frame-id="${frame.id}"]`);
    if (!frameEl) continue;
    const memberIds = Array.isArray(frame.cards) ? frame.cards : [];
    const boxIds = includeCard ? memberIds : memberIds.filter((id) => id !== cardId);
    const memberBoxes = boxIds
      .map((id) => boardSurface.querySelector(`[data-card-id="${id}"]`))
      .filter(Boolean)
      .map((el) => ({
        left: parseFloat(el.style.left) || 0,
        top: parseFloat(el.style.top) || 0,
        width: el.offsetWidth || CARD_WIDTH,
        height: el.offsetHeight || CARD_HEIGHT,
      }));
    if (memberBoxes.length === 0) {
      frameEl.style.visibility = 'hidden';
      continue;
    }
    frameEl.style.visibility = '';
    const minX = Math.min(...memberBoxes.map((b) => b.left)) - FRAME_PAD;
    const minY = Math.min(...memberBoxes.map((b) => b.top)) - FRAME_PAD;
    const maxX = Math.max(...memberBoxes.map((b) => b.left + b.width)) + FRAME_PAD;
    const maxY = Math.max(...memberBoxes.map((b) => b.top + b.height)) + FRAME_PAD;
    frameEl.style.left = `${minX}px`;
    frameEl.style.top = `${minY}px`;
    frameEl.style.width = `${maxX - minX}px`;
    frameEl.style.height = `${maxY - minY}px`;
  }
}

function beginMultiDrag(clickedEl, cardIds, state, pointerId, startX, startY) {
  const cardEls = cardIds
    .map((id) => canvasLayer.querySelector(`[data-card-id="${id}"]`))
    .filter(Boolean);

  const initialPositions = cardEls.map((el) => ({
    el,
    id: el.dataset.cardId,
    left: parseFloat(el.style.left) || 0,
    top: parseFloat(el.style.top) || 0,
  }));

  for (const el of cardEls) el.classList.add('is-dragging');
  clickedEl.setPointerCapture(pointerId);

  const move = (moveEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    const dx = (moveEvent.clientX - startX) / zoom;
    const dy = (moveEvent.clientY - startY) / zoom;
    for (const m of initialPositions) {
      m.el.style.left = `${m.left + dx}px`;
      m.el.style.top = `${m.top + dy}px`;
      m.el.dataset.left = String(m.left + dx);
      m.el.dataset.top = String(m.top + dy);
    }
    updateConnectionLayer(state);
    updateFramesDuringDrag(null, true);
  };

  const finish = (finishEvent) => {
    if (finishEvent.pointerId !== pointerId) return;
    const dx = (finishEvent.clientX - startX) / zoom;
    const dy = (finishEvent.clientY - startY) / zoom;
    clickedEl.removeEventListener('pointermove', move);
    clickedEl.removeEventListener('pointerup', finish);
    clickedEl.removeEventListener('pointercancel', finish);
    try { clickedEl.releasePointerCapture(pointerId); } catch { /* ignore */ }
    for (const el of cardEls) el.classList.remove('is-dragging');
    for (const m of initialPositions) {
      setStoredPosition(state.id, m.id, m.left + dx, m.top + dy);
    }
    renderBoard(store.getState());
  };

  clickedEl.addEventListener('pointermove', move);
  clickedEl.addEventListener('pointerup', finish);
  clickedEl.addEventListener('pointercancel', finish);
}

function beginDrag(cardElement, cardId, state, pointerId, startX, startY) {
  cardElement.classList.add('is-dragging');
  cardElement.setPointerCapture(pointerId);

  const initialLeft = Number.parseFloat(cardElement.style.left) || 0;
  const initialTop = Number.parseFloat(cardElement.style.top) || 0;

  const move = (moveEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }

    const nextLeft = initialLeft + (moveEvent.clientX - startX) / zoom;
    const nextTop = initialTop + (moveEvent.clientY - startY) / zoom;

    cardElement.style.left = `${nextLeft}px`;
    cardElement.style.top = `${nextTop}px`;
    cardElement.dataset.left = String(nextLeft);
    cardElement.dataset.top = String(nextTop);
    updateConnectionLayer(state);
    updateFramesDuringDrag(cardId, !spaceDown);
  };

  let onDragSpaceChange = null;

  const finish = (finishEvent) => {
    if (finishEvent.pointerId !== pointerId) {
      return;
    }

    if (onDragSpaceChange) {
      window.removeEventListener('keydown', onDragSpaceChange);
      window.removeEventListener('keyup', onDragSpaceChange);
    }

    const left = Number.parseFloat(cardElement.dataset.left || cardElement.style.left) || initialLeft;
    const top = Number.parseFloat(cardElement.dataset.top || cardElement.style.top) || initialTop;
    setStoredPosition(state.id, cardId, left, top);
    updateConnectionLayer(state);
    cardElement.classList.remove('is-dragging');
    cardElement.removeEventListener('pointermove', move);
    cardElement.removeEventListener('pointerup', finish);
    cardElement.removeEventListener('pointercancel', finish);
    try {
      cardElement.releasePointerCapture(pointerId);
    } catch {
      // Ignore capture release failures.
    }

    // Update frame membership based on new card position.
    // Without space, membership is frozen — frame expands to follow the card.
    // Holding space allows escape: membership is recalculated and the card can leave.
    if (!spaceDown) {
      renderBoard(store.getState());
      return;
    }
    const cardWidth = cardElement.offsetWidth || CARD_WIDTH;
    const cardHeight = cardElement.offsetHeight || CARD_HEIGHT;
    const cardCenterX = left + cardWidth / 2;
    const cardCenterY = top + cardHeight / 2;

    const currentState = store.getState();
    let newFrameId = null;

    for (const frame of currentState.frames) {
      const memberIds = Array.isArray(frame.cards) ? frame.cards : [];
      // Compute frame bbox excluding the dragged card to avoid self-containment bias.
      const otherBoxes = memberIds
        .filter((id) => id !== cardId)
        .map((id) => boardSurface.querySelector(`[data-card-id="${id}"]`))
        .filter(Boolean)
        .map((el) => ({
          left: parseFloat(el.style.left) || 0,
          top: parseFloat(el.style.top) || 0,
          width: el.offsetWidth || CARD_WIDTH,
          height: el.offsetHeight || CARD_HEIGHT,
        }));

      // No other members and card isn't in this frame — nothing to check.
      if (otherBoxes.length === 0 && !memberIds.includes(cardId)) continue;
      // Card is sole member — no fixed boundary, so it can always be dragged out.
      if (otherBoxes.length === 0) continue;

      const bboxMinX = Math.min(...otherBoxes.map((b) => b.left)) - FRAME_PAD;
      const bboxMinY = Math.min(...otherBoxes.map((b) => b.top)) - FRAME_PAD;
      const bboxMaxX = Math.max(...otherBoxes.map((b) => b.left + b.width)) + FRAME_PAD;
      const bboxMaxY = Math.max(...otherBoxes.map((b) => b.top + b.height)) + FRAME_PAD;

      if (cardCenterX >= bboxMinX && cardCenterX <= bboxMaxX && cardCenterY >= bboxMinY && cardCenterY <= bboxMaxY) {
        newFrameId = frame.id;
        break;
      }
    }

    // Apply membership changes.
    let needsRender = false;
    for (const frame of currentState.frames) {
      const memberIds = Array.isArray(frame.cards) ? frame.cards : [];
      const isCurrentMember = memberIds.includes(cardId);
      const shouldBeMember = frame.id === newFrameId;

      if (isCurrentMember && !shouldBeMember) {
        const newCards = memberIds.filter((id) => id !== cardId);
        if (newCards.length === 0) {
          store.deleteFrame(frame.id);
        } else {
          store.updateFrameCards(frame.id, newCards);
        }
        needsRender = true;
      } else if (!isCurrentMember && shouldBeMember) {
        store.updateFrameCards(frame.id, [...memberIds, cardId]);
        needsRender = true;
      }
    }

    if (!needsRender) {
      renderBoard(store.getState());
    }
    // If needsRender is true, emitChange from store calls already triggered renderBoard via onChange.
  };

  onDragSpaceChange = () => updateFramesDuringDrag(cardId, !spaceDown);
  window.addEventListener('keydown', onDragSpaceChange);
  window.addEventListener('keyup', onDragSpaceChange);

  cardElement.addEventListener('pointermove', move);
  cardElement.addEventListener('pointerup', finish);
  cardElement.addEventListener('pointercancel', finish);
}

function beginConnection(cardElement, cardId, state, pointerId, startX, startY) {
  closeEditor();
  cancelConnectionGesture();
  cardElement.setPointerCapture(pointerId);

  const sourceBox = getCardBox(cardElement);
  const boardRect = boardSurface.getBoundingClientRect();
  activeConnectionGesture = {
    fromCardId: cardId,
    toCardId: cardId,
    pointerId,
    sourceElement: cardElement,
  };

  cardElement.classList.add('is-connection-source');
  connectionDraft.classList.add('is-visible');
  const startCursorX = startX - boardRect.left;
  const startCursorY = startY - boardRect.top;
  const startEdge = getEdgePoint(sourceBox, (startCursorX - panX) / zoom, (startCursorY - panY) / zoom);
  connectionDraftLine.setAttribute('d', bezierPath(
    startEdge.x * zoom + panX, startEdge.y * zoom + panY,
    startCursorX, startCursorY,
  ));

  let currentTargetElement = null;

  const move = (moveEvent) => {
    if (!activeConnectionGesture || moveEvent.pointerId !== pointerId) {
      return;
    }

    const targetCardId = getPointerCardId(moveEvent);
    const targetCardElement =
      targetCardId && targetCardId !== cardId ? getCardElement(targetCardId) : null;

    const newTargetElement = targetCardElement !== cardElement ? targetCardElement : null;
    if (newTargetElement !== currentTargetElement) {
      if (currentTargetElement) currentTargetElement.classList.remove('is-connection-target');
      if (newTargetElement) newTargetElement.classList.add('is-connection-target');
      currentTargetElement = newTargetElement;
    }

    activeConnectionGesture.toCardId = targetCardId || cardId;

    if (targetCardElement) {
      const targetBox = getCardBox(targetCardElement);
      const { x1, y1, x2, y2 } = getConnectionEndpoints(sourceBox, targetBox);
      connectionDraftLine.setAttribute('d', bezierPath(
        x1 * zoom + panX, y1 * zoom + panY,
        x2 * zoom + panX, y2 * zoom + panY,
      ));
    } else {
      const cursorX = moveEvent.clientX - boardRect.left;
      const cursorY = moveEvent.clientY - boardRect.top;
      const edge = getEdgePoint(sourceBox, (cursorX - panX) / zoom, (cursorY - panY) / zoom);
      connectionDraftLine.setAttribute('d', bezierPath(
        edge.x * zoom + panX, edge.y * zoom + panY,
        cursorX, cursorY,
      ));
    }
  };

  const finish = (finishEvent) => {
    if (!activeConnectionGesture || finishEvent.pointerId !== pointerId) {
      return;
    }

    const targetCardId = getPointerCardId(finishEvent);
    const targetCardElement =
      targetCardId && targetCardId !== cardId ? getCardElement(targetCardId) : null;

    cardElement.removeEventListener('pointermove', move);
    cardElement.removeEventListener('pointerup', finish);
    cardElement.removeEventListener('pointercancel', finish);
    try {
      cardElement.releasePointerCapture(pointerId);
    } catch {
      // Ignore capture release failures.
    }

    cardElement.classList.remove('is-connection-source');

    if (!targetCardElement || targetCardId === cardId) {
      if (currentTargetElement) {
        currentTargetElement.classList.remove('is-connection-target');
        currentTargetElement = null;
      }
      if (finishEvent.type === 'pointercancel' || targetCardId === cardId) {
        cancelConnectionGesture();
        return;
      }
      // Dropped on empty canvas — create a card at the drop point and connect.
      const dropX = (finishEvent.clientX - boardRect.left - panX) / zoom - CARD_WIDTH / 2;
      const dropY = (finishEvent.clientY - boardRect.top - panY) / zoom - CARD_HEIGHT / 2;
      const newCardId = `h-${store.nextHumanCardNumber()}`;
      setStoredPosition(store.getState().id, newCardId, dropX, dropY);
      cancelConnectionGesture();
      const newCard = store.addCard('', currentScope || undefined);
      store.addConnection(cardId, newCard.id, '', currentScope || undefined);
      openEditor(newCard.id, { isNewCard: true });
      return;
    }

    if (currentTargetElement) {
      currentTargetElement.classList.remove('is-connection-target');
      currentTargetElement = null;
    }

    const fromBox = getCardBox(cardElement);
    const toBox = getCardBox(targetCardElement);
    const { x1, y1, x2, y2 } = getConnectionEndpoints(fromBox, toBox);
    activeConnectionGesture.toCardId = targetCardId;
    showConnectionPrompt(
      (x1 + x2) / 2,
      (y1 + y2) / 2,
      {
        mode: 'create',
        fromCardId: cardId,
        toCardId: targetCardId,
      },
    );
  };

  cardElement.addEventListener('pointermove', move);
  cardElement.addEventListener('pointerup', finish);
  cardElement.addEventListener('pointercancel', finish);
}

function validateBoard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The file must contain a JSON object.');
  }

  if (typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error('The board id must be a non-empty string.');
  }

  if (!Array.isArray(value.cards)) {
    throw new Error('The cards field must be an array.');
  }

  if (!Array.isArray(value.connections)) {
    throw new Error('The connections field must be an array.');
  }

  const seenCardIds = new Set();
  const cards = value.cards.map((card, index) => {
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
      throw new Error(`Card ${index + 1} must be an object.`);
    }

    if (typeof card.id !== 'string' || !card.id.trim()) {
      throw new Error(`Card ${index + 1} must have a non-empty string id.`);
    }

    if (seenCardIds.has(card.id)) {
      throw new Error(`Duplicate card id: ${card.id}`);
    }
    seenCardIds.add(card.id);

    if (typeof card.text !== 'string') {
      throw new Error(`Card ${card.id} must have text as a string.`);
    }

    const normalized = { id: card.id, text: card.text };
    if (typeof card.parentId === 'string' && card.parentId.trim()) {
      normalized.parentId = card.parentId.trim();
    }
    return normalized;
  });

  const cardIds = new Set(cards.map((card) => card.id));
  const connections = [];
  for (const connection of value.connections) {
    if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
      continue;
    }

    if (typeof connection.from !== 'string' || typeof connection.to !== 'string') {
      continue;
    }

    if (!cardIds.has(connection.from) || !cardIds.has(connection.to) || connection.from === connection.to) {
      continue;
    }

    const normalized = { from: connection.from, to: connection.to };
    if (typeof connection.label === 'string' && connection.label.trim()) {
      normalized.label = connection.label.trim();
    }
    if (typeof connection.scope === 'string' && connection.scope.trim()) {
      normalized.scope = connection.scope.trim();
    }
    connections.push(normalized);
  }

  const frames = [];
  if (Array.isArray(value.frames)) {
    for (const f of value.frames) {
      if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
      if (typeof f.id !== 'string' || !f.id.trim()) continue;
      // Old format with x/y/width/height is dropped (no migration).
      if (!Array.isArray(f.cards)) continue;
      const frame = {
        id: f.id,
        text: typeof f.text === 'string' ? f.text : '',
        cards: f.cards.filter((c) => typeof c === 'string' && c.trim()),
      };
      if (typeof f.scope === 'string' && f.scope.trim()) frame.scope = f.scope.trim();
      frames.push(frame);
    }
  }

  return {
    id: value.id.trim(),
    cards,
    connections,
    frames,
  };
}

function beginFrameDragMembers(frameEl, frame, pointerId, startX, startY) {
  frameEl.setPointerCapture(pointerId);
  const memberIds = Array.isArray(frame.cards) ? frame.cards : [];
  const memberEls = memberIds.map((id) => boardSurface.querySelector(`[data-card-id="${id}"]`)).filter(Boolean);
  const initialPositions = memberEls.map((el) => ({
    el,
    id: el.dataset.cardId,
    left: parseFloat(el.style.left) || 0,
    top: parseFloat(el.style.top) || 0,
  }));
  const initialFrameLeft = parseFloat(frameEl.style.left) || 0;
  const initialFrameTop = parseFloat(frameEl.style.top) || 0;

  const move = (moveEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    const dx = (moveEvent.clientX - startX) / zoom;
    const dy = (moveEvent.clientY - startY) / zoom;
    for (const m of initialPositions) {
      m.el.style.left = `${m.left + dx}px`;
      m.el.style.top = `${m.top + dy}px`;
      m.el.dataset.left = String(m.left + dx);
      m.el.dataset.top = String(m.top + dy);
    }
    frameEl.style.left = `${initialFrameLeft + dx}px`;
    frameEl.style.top = `${initialFrameTop + dy}px`;
    updateConnectionLayer(store.getState());
  };

  const finish = (finishEvent) => {
    if (finishEvent.pointerId !== pointerId) return;
    const dx = (finishEvent.clientX - startX) / zoom;
    const dy = (finishEvent.clientY - startY) / zoom;
    frameEl.removeEventListener('pointermove', move);
    frameEl.removeEventListener('pointerup', finish);
    frameEl.removeEventListener('pointercancel', finish);
    try { frameEl.releasePointerCapture(pointerId); } catch { /* ignore */ }
    for (const m of initialPositions) {
      setStoredPosition(store.getState().id, m.id, m.left + dx, m.top + dy);
    }
    renderBoard(store.getState());
  };

  frameEl.addEventListener('pointermove', move);
  frameEl.addEventListener('pointerup', finish);
  frameEl.addEventListener('pointercancel', finish);
}

function openFrameLabelEditor(frameEl, frameId) {
  const labelEl = frameEl.querySelector('.frame__label');
  if (!labelEl) return;

  const frameData = store.getState().frames.find((f) => f.id === frameId);
  const input = document.createElement('input');
  input.type = 'text';
  input.value = frameData ? frameData.text : '';
  input.className = 'frame__label-input';
  input.style.cssText = [
    'position:absolute',
    'top:-28px',
    'left:8px',
    'background:rgba(30,30,46,0.95)',
    'border:1px solid rgba(180,190,254,0.5)',
    'border-radius:6px',
    'color:rgba(180,190,254,0.9)',
    'font:500 12px/1.4 inherit',
    'padding:2px 6px',
    'outline:none',
    'min-width:80px',
    'pointer-events:all',
    'z-index:10',
  ].join(';');

  labelEl.style.display = 'none';
  frameEl.appendChild(input);
  input.focus();
  input.select();

  const commit = () => {
    const newText = input.value;
    input.remove();
    labelEl.style.display = '';
    store.updateFrameText(frameId, newText);
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); input.blur(); }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      input.removeEventListener('blur', commit);
      input.remove();
      labelEl.style.display = '';
    }
  });
}

function renderBoard(state) {
  cancelConnectionGesture();
  boardName.textContent = state.id;
  canvasLayer.innerHTML = '';
  canvasLayer.appendChild(boardHint);

  // Filter state to current scope, preserving original indices.
  const visibleCards = state.cards.filter((card) =>
    currentScope === null ? !card.parentId : card.parentId === currentScope,
  );
  const visibleConnectionEntries = state.connections
    .map((conn, idx) => ({ conn, idx }))
    .filter(({ conn }) =>
      currentScope === null ? !conn.scope : conn.scope === currentScope,
    );
  const visibleConnections = visibleConnectionEntries.map(({ conn }) => conn);

  const positionsById = new Map(Object.entries(getBoardPositions({ ...state, cards: visibleCards, connections: visibleConnections })));
  const positionedCards = visibleCards.map((card) => {
    const position = positionsById.get(card.id) || {
      x: CARD_MARGIN,
      y: CARD_MARGIN,
    };
    return {
      card,
      x: position.x,
      y: position.y,
      centerX: position.x + CARD_WIDTH / 2,
      centerY: position.y + CARD_HEIGHT / 2,
    };
  });

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'board__connections');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'connectionArrow');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '8');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '5');
  marker.setAttribute('orient', 'auto-start-reverse');
  marker.setAttribute('markerUnits', 'strokeWidth');
  const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrowPath.setAttribute('fill', 'rgba(148, 163, 184, 0.95)');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  visibleConnectionEntries.forEach(({ conn: connection, idx: index }) => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('connection');
    group.dataset.connectionIndex = String(index);

    const from = positionsById.get(connection.from);
    const to = positionsById.get(connection.to);
    if (!from || !to) {
      group.setAttribute('visibility', 'hidden');
    }

    const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitPath.classList.add('connection__hit');
    hitPath.setAttribute('d', bezierPath(
      from ? from.centerX : 0,
      from ? from.centerY : 0,
      to ? to.centerX : 0,
      to ? to.centerY : 0,
    ));
    group.appendChild(hitPath);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.classList.add('connection__line');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.setAttribute('marker-end', 'url(#connectionArrow)');
    line.setAttribute('d', bezierPath(
      from ? from.centerX : 0,
      from ? from.centerY : 0,
      to ? to.centerX : 0,
      to ? to.centerY : 0,
    ));
    group.appendChild(line);

    if (typeof connection.label === 'string' && connection.label.trim()) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.classList.add('connection__label');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.textContent = connection.label;
      group.appendChild(label);
    }

    group.addEventListener('pointerenter', () => { hoveredConnectionIndex = index; });
    group.addEventListener('pointerleave', () => { if (hoveredConnectionIndex === index) hoveredConnectionIndex = null; });

    group.addEventListener('click', (event) => {
      if (event.button !== 0) {
        return;
      }

      event.stopPropagation();
      selectConnection(index);
    });

    group.addEventListener('dblclick', (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      selectConnection(index);
      const currentLabel = typeof connection.label === 'string' ? connection.label : '';
      const boxes = getCardBoxesById();
      const fromBox = boxes.get(connection.from);
      const toBox = boxes.get(connection.to);
      const ep = fromBox && toBox ? getConnectionEndpoints(fromBox, toBox) : { x1: 0, y1: 0, x2: 0, y2: 0 };
      showConnectionPrompt(
        (ep.x1 + ep.x2) / 2,
        (ep.y1 + ep.y2) / 2,
        { mode: 'edit', connectionIndex: index },
        currentLabel,
      );
    });

    svg.appendChild(group);
  });

  // svg is appended after cards and frames so connection lines sit on top and remain clickable.

  // Build card→frame-color map for tinting cards that belong to a frame.
  const cardFrameColor = new Map();
  for (const frame of state.frames) {
    const color = frameColorForId(frame.id);
    for (const cardId of (Array.isArray(frame.cards) ? frame.cards : [])) {
      cardFrameColor.set(cardId, color);
    }
  }

  const containerChildCount = new Map();
  for (const c of state.cards) {
    if (c.parentId) containerChildCount.set(c.parentId, (containerChildCount.get(c.parentId) ?? 0) + 1);
  }

  for (const entry of positionedCards) {
    const card = document.createElement('div');
    const childCount = containerChildCount.get(entry.card.id) ?? 0;
    card.className = childCount > 0 ? 'card card--container' : 'card';
    card.style.left = `${entry.x}px`;
    card.style.top = `${entry.y}px`;
    card.dataset.cardId = entry.card.id;
    card.dataset.left = String(entry.x);
    card.dataset.top = String(entry.y);
    const fc = cardFrameColor.get(entry.card.id);
    if (fc) {
      card.style.backgroundColor = `rgba(${fc.r}, ${fc.g}, ${fc.b}, 0.9)`;
      card.style.borderColor = `rgba(${fc.r}, ${fc.g}, ${fc.b}, 0.7)`;
      card.style.color = '#1e1e2e';
      card.style.setProperty('--muted', 'rgba(30,30,46,0.6)');
    }
    card.innerHTML = `
      <div class="card__id">${entry.card.id}</div>
      <div class="card__text"></div>
      ${childCount > 0 ? `<div class="card__children">${childCount}</div>` : ''}
    `;
    card.querySelector('.card__text').textContent = entry.card.text;
    card.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      const now = Date.now();
      const isDoubleClick = entry.card.id === lastPointerDownCardId && now - lastPointerDownTime < 300;
      lastPointerDownCardId = entry.card.id;
      lastPointerDownTime = now;
      if (isDoubleClick) {
        openEditor(entry.card.id, { isNewCard: false });
        return;
      }

      if (event.shiftKey) {
        selectCard(entry.card.id);
        beginConnection(card, entry.card.id, state, event.pointerId, event.clientX, event.clientY);
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        toggleCardInSelection(entry.card.id);
        return;
      }

      if (selectedItem && selectedItem.type === 'cards' && selectedItem.ids.includes(entry.card.id)) {
        beginMultiDrag(card, selectedItem.ids, state, event.pointerId, event.clientX, event.clientY);
      } else {
        selectCard(entry.card.id);
        beginDrag(card, entry.card.id, state, event.pointerId, event.clientX, event.clientY);
      }
    });
    canvasLayer.appendChild(card);
  }

  // Render frames after cards so card DOM positions are available for bbox computation.
  {
    const visibleFrames = state.frames.filter((f) =>
      currentScope === null ? !f.scope : f.scope === currentScope,
    );
    // First pass: compute all frame bboxes.
    const frameBboxes = new Map();
    for (const frame of visibleFrames) {
      const memberIds = Array.isArray(frame.cards) ? frame.cards : [];
      const memberBoxes = [];
      for (const cardId of memberIds) {
        const el = boardSurface.querySelector(`[data-card-id="${cardId}"]`);
        if (!el) continue;
        memberBoxes.push({
          left: parseFloat(el.style.left) || 0,
          top: parseFloat(el.style.top) || 0,
          width: el.offsetWidth || CARD_WIDTH,
          height: el.offsetHeight || CARD_HEIGHT,
        });
      }
      if (memberBoxes.length === 0) continue;
      frameBboxes.set(frame.id, {
        minX: Math.min(...memberBoxes.map((b) => b.left)) - FRAME_PAD,
        minY: Math.min(...memberBoxes.map((b) => b.top)) - FRAME_PAD,
        maxX: Math.max(...memberBoxes.map((b) => b.left + b.width)) + FRAME_PAD,
        maxY: Math.max(...memberBoxes.map((b) => b.top + b.height)) + FRAME_PAD,
      });
    }

    // Second pass: for each frame, count how many earlier frames substantially overlap it
    // and assign an expansion level so stacked frames grow outward and peek behind each other.
    const frameOverlapSteps = new Map();
    const EXPAND_STEP = 10;
    for (let i = 0; i < visibleFrames.length; i++) {
      const frame = visibleFrames[i];
      const bbox = frameBboxes.get(frame.id);
      if (!bbox) { frameOverlapSteps.set(frame.id, 0); continue; }
      const bboxArea = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
      let overlapCount = 0;
      for (let j = 0; j < i; j++) {
        const otherBbox = frameBboxes.get(visibleFrames[j].id);
        if (!otherBbox) continue;
        const ix0 = Math.max(bbox.minX, otherBbox.minX);
        const iy0 = Math.max(bbox.minY, otherBbox.minY);
        const ix1 = Math.min(bbox.maxX, otherBbox.maxX);
        const iy1 = Math.min(bbox.maxY, otherBbox.maxY);
        if (ix1 <= ix0 || iy1 <= iy0) continue;
        if ((ix1 - ix0) * (iy1 - iy0) / bboxArea > 0.7) overlapCount++;
      }
      frameOverlapSteps.set(frame.id, overlapCount);
    }

    // Third pass: render frames, expanding overlapping ones outward and pushing them behind.
    for (const frame of visibleFrames) {
      const bbox = frameBboxes.get(frame.id);
      if (!bbox) continue;
      const { minX, minY, maxX, maxY } = bbox;
      const steps = frameOverlapSteps.get(frame.id) || 0;
      const exp = steps * EXPAND_STEP;

      const fc = frameColorForId(frame.id);
      const frameEl = document.createElement('div');
      frameEl.className = 'frame';
      frameEl.dataset.frameId = frame.id;
      frameEl.style.left = `${minX - exp}px`;
      frameEl.style.top = `${minY - exp}px`;
      frameEl.style.width = `${maxX - minX + exp * 2}px`;
      frameEl.style.height = `${maxY - minY + exp * 2}px`;
      if (steps > 0) frameEl.style.zIndex = String(-steps);
      frameEl.style.borderColor = `rgba(${fc.r}, ${fc.g}, ${fc.b}, 0.65)`;
      frameEl.style.backgroundColor = `rgba(${fc.r}, ${fc.g}, ${fc.b}, 0.06)`;

      const labelEl = document.createElement('div');
      labelEl.className = 'frame__label';
      if (frame.text) {
        labelEl.textContent = frame.text;
      } else {
        labelEl.textContent = 'Label…';
        labelEl.classList.add('frame__label--placeholder');
      }
      labelEl.style.color = `rgba(${fc.r}, ${fc.g}, ${fc.b}, 0.9)`;
      labelEl.style.backgroundColor = `rgba(${fc.r}, ${fc.g}, ${fc.b}, 0.15)`;
      frameEl.appendChild(labelEl);

      // Frame interaction is handled by the canvasLayer capture listener below.

      canvasLayer.appendChild(frameEl);
    }
  }

  // Append SVG after frames so connection strokes are on top and receive click/dblclick events.
  canvasLayer.appendChild(svg);

  updateConnectionLayer(state);
  syncSelection();
  if (activeEditor) {
    positionEditor();
  }
}

async function loadBoardFromFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }

  return validateBoard(parsed);
}

async function handleFile(file) {
  if (!file) {
    return;
  }

  try {
    closeEditor(false);
    clearSelection();
    if (currentScope !== null) { currentScope = null; rootViewSnapshot = null; board.classList.remove('board--in-scope'); }
    const boardData = await loadBoardFromFile(file);
    clearError();
    showBoard(boardData.id);
    store.setBoard(boardData);
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Failed to load the file.');
  }
}

store.onChange(renderBoard);

newBoardButton.addEventListener('click', () => {
  if (confirm('Start a new board? This will clear all current content.')) {
    store.setBoard({ id: store.boardId, cards: [], connections: [], frames: [] });
  }
});
loadButton.addEventListener('click', openFilePicker);
copyButton.addEventListener('click', async () => {
  try {
    await copyBoardJson();
    clearError();
    const originalText = copyButton.textContent;
    copyButton.textContent = 'Copied!';
    setTimeout(() => { copyButton.textContent = originalText; }, 1500);
  } catch {
    showError('Copy JSON failed. The browser blocked clipboard access.');
  }
});
downloadButton.addEventListener('click', () => {
  downloadBoardJson();
});

openFolderButton.addEventListener('click', () => {
  fetch('/open-folder', { method: 'POST' }).catch(() => {});
});

layoutButton.addEventListener('click', () => {
  const state = store.getState();
  localStorage.removeItem(boardPositionKey(state.id));
  renderBoard(state);
});

fileInput.addEventListener('change', () => {
  handleFile(fileInput.files && fileInput.files[0]);
});

boardSurface.addEventListener('dblclick', (event) => {
  const cardElement = event.target.closest('.card');
  if (cardElement) {
    event.stopPropagation();
    openEditor(cardElement.dataset.cardId, { isNewCard: false });
    return;
  }

  if (event.target.closest('.connection')) {
    return;
  }

  const bounds = boardSurface.getBoundingClientRect();
  const x = (event.clientX - bounds.left - panX) / zoom - CARD_WIDTH / 2;
  const y = (event.clientY - bounds.top - panY) / zoom - CARD_HEIGHT / 2;
  const cardId = `h-${store.nextHumanCardNumber()}`;
  setStoredPosition(store.getState().id, cardId, x, y);
  const card = store.addCard('', currentScope);

  // If the double-click was inside a frame's interior, add the new card to that frame.
  const frameEl = event.target.closest('.frame');
  if (frameEl && frameEl.dataset.frameId) {
    const frameData = store.getState().frames.find((f) => f.id === frameEl.dataset.frameId);
    if (frameData) {
      store.updateFrameCards(frameData.id, [...(Array.isArray(frameData.cards) ? frameData.cards : []), card.id]);
    }
  }

  openEditor(card.id, { isNewCard: true });
});

boardSurface.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;

  if (event.target.closest('.card') || event.target.closest('.connection')) return;

  const boardRect = boardSurface.getBoundingClientRect();
  const startX = event.clientX - boardRect.left;
  const startY = event.clientY - boardRect.top;
  let dragging = false;

  const move = (moveEvent) => {
    const x = moveEvent.clientX - boardRect.left;
    const y = moveEvent.clientY - boardRect.top;
    if (!dragging && Math.hypot(x - startX, y - startY) < 6) return;

    if (!dragging) {
      dragging = true;
      clearSelection();
    }

    marqueeRect.style.left = `${Math.min(startX, x)}px`;
    marqueeRect.style.top = `${Math.min(startY, y)}px`;
    marqueeRect.style.width = `${Math.abs(x - startX)}px`;
    marqueeRect.style.height = `${Math.abs(y - startY)}px`;
    marqueeRect.classList.add('is-visible');
  };

  const finish = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    marqueeRect.classList.remove('is-visible');

    if (!dragging) {
      clearSelection();
      return;
    }

    const left = Number.parseFloat(marqueeRect.style.left);
    const top = Number.parseFloat(marqueeRect.style.top);
    const right = left + Number.parseFloat(marqueeRect.style.width);
    const bottom = top + Number.parseFloat(marqueeRect.style.height);

    const ids = [];
    for (const el of canvasLayer.querySelectorAll('.card')) {
      const cLeft = (Number.parseFloat(el.dataset.left || el.style.left) || 0) * zoom + panX;
      const cTop = (Number.parseFloat(el.dataset.top || el.style.top) || 0) * zoom + panY;
      const cRight = cLeft + (el.offsetWidth || CARD_WIDTH) * zoom;
      const cBottom = cTop + (el.offsetHeight || CARD_HEIGHT) * zoom;
      if (cLeft < right && cRight > left && cTop < bottom && cBottom > top) {
        ids.push(el.dataset.cardId);
      }
    }

    if (ids.length > 0) {
      selectCards(ids);
    } else {
      // No cards hit — check if the marquee covers any frame.
      for (const el of canvasLayer.querySelectorAll('.frame')) {
        const fLeft = (Number.parseFloat(el.style.left) || 0) * zoom + panX;
        const fTop = (Number.parseFloat(el.style.top) || 0) * zoom + panY;
        const fRight = fLeft + (Number.parseFloat(el.style.width) || 0) * zoom;
        const fBottom = fTop + (Number.parseFloat(el.style.height) || 0) * zoom;
        if (fLeft < right && fRight > left && fTop < bottom && fBottom > top) {
          selectFrame(el.dataset.frameId);
          break;
        }
      }
    }
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
});

cardEditor.addEventListener('input', () => {
  resizeEditorToContent();
});

cardEditor.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    const editor = activeEditor;
    closeEditor(false);
    if (editor && editor.isNewCard) {
      store.deleteCard(editor.cardId);
      return;
    }
    if (editor) {
      store.updateCardText(editor.cardId, editor.originalText);
    }
    return;
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    if (activeEditor) closeEditor();
  }
});

cardEditor.addEventListener('blur', () => {
  closeEditor();
});

connectionPrompt.addEventListener('submit', (event) => {
  event.preventDefault();
  commitConnectionPrompt(connectionLabelInput.value);
});

connectionLabelInput.addEventListener('blur', () => {
  if (activeConnectionPrompt) {
    commitConnectionPrompt(connectionLabelInput.value);
  }
});

connectionLabelInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (activeConnectionPrompt && activeConnectionPrompt.mode === 'edit') {
      hideConnectionPrompt();
      return;
    }

    cancelConnectionPrompt();
    return;
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    commitConnectionPrompt(connectionLabelInput.value);
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Shift') {
    canvas.classList.add('canvas--shift');
  }
  if (event.key === ' ') {
    spaceDown = true;
  }
});

window.addEventListener('keyup', (event) => {
  if (event.key === 'Shift') {
    canvas.classList.remove('canvas--shift');
  }
  if (event.key === ' ') {
    spaceDown = false;
  }
});

window.addEventListener('blur', () => {
  canvas.classList.remove('canvas--shift');
  spaceDown = false;
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Backspace' && event.key !== 'Delete') {
    return;
  }

  if (shortcutsOverlay.classList.contains('is-visible')) {
    return;
  }

  const activeElement = document.activeElement;
  if (
    activeElement &&
    (activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable)
  ) {
    return;
  }

  if (!selectedItem) {
    return;
  }

  event.preventDefault();
  const selection = selectedItem;

  if (selection.type === 'card') {
    store.deleteCard(selection.id);
    return;
  }

  if (selection.type === 'cards') {
    store.deleteCards(selection.ids);
    return;
  }

  if (selection.type === 'frame') {
    store.deleteFrame(selection.id);
    return;
  }

  const connectionIndex = resolveSelectedConnectionIndex(store.getState());
  if (connectionIndex !== null) {
    store.deleteConnection(connectionIndex);
  }
});

window.addEventListener('resize', () => renderBoard(store.getState()));

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const boardRect = boardSurface.getBoundingClientRect();
  const mouseX = event.clientX - boardRect.left;
  const mouseY = event.clientY - boardRect.top;

  if (event.ctrlKey) {
    const factor = Math.exp(-event.deltaY * 0.01);
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    const k = newZoom / zoom;
    panX = mouseX - (mouseX - panX) * k;
    panY = mouseY - (mouseY - panY) * k;
    zoom = newZoom;
  } else {
    panX -= event.deltaX;
    panY -= event.deltaY;
  }

  applyViewport();
}, { passive: false });

function openShortcuts() {
  shortcutsOverlay.classList.add('is-visible');
  shortcutsClose.focus();
}

function closeShortcuts() {
  shortcutsOverlay.classList.remove('is-visible');
}

breadcrumbBack.addEventListener('click', exitScope);

shortcutsButton.addEventListener('click', openShortcuts);
shortcutsClose.addEventListener('click', closeShortcuts);

shortcutsOverlay.addEventListener('click', (event) => {
  if (event.target === shortcutsOverlay) {
    closeShortcuts();
  }
});

window.addEventListener('keydown', (event) => {
  if (shortcutsOverlay.classList.contains('is-visible')) {
    if (event.key === 'Escape') {
      closeShortcuts();
    }
    return;
  }

  const activeElement = document.activeElement;
  if (
    activeElement &&
    (activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable)
  ) {
    return;
  }

  if ((event.key === 'z' || event.key === 'Z') && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
    event.preventDefault();
    store.undo();
    return;
  }

  if (
    ((event.key === 'z' || event.key === 'Z') && (event.metaKey || event.ctrlKey) && event.shiftKey) ||
    (event.key === 'y' && event.ctrlKey && !event.metaKey)
  ) {
    event.preventDefault();
    store.redo();
    return;
  }

  if (event.key === '?') {
    openShortcuts();
  }

  if (event.key === '0') {
    centerOnOrigin();
  }

  if ((event.key === 'f' || event.key === 'F') && !event.metaKey && !event.ctrlKey) {
    let selectedCardIds = null;
    if (selectedItem && selectedItem.type === 'card') {
      selectedCardIds = [selectedItem.id];
    } else if (selectedItem && selectedItem.type === 'cards' && selectedItem.ids.length > 0) {
      selectedCardIds = selectedItem.ids;
    }
    if (selectedCardIds) {
      event.preventDefault();
      const newFrame = store.addFrame('', selectedCardIds, currentScope || undefined);
      selectFrame(newFrame.id);
      const frameEl = boardSurface.querySelector(`.frame[data-frame-id="${newFrame.id}"]`);
      if (frameEl) openFrameLabelEditor(frameEl, newFrame.id);
    }
    return;
  }

  if (event.key === 'Escape' && currentScope !== null && !activeConnectionPrompt) {
    exitScope();
    return;
  }

  if (event.key === 'Enter' && hoveredConnectionIndex !== null && !event.repeat) {
    const state = store.getState();
    const connection = state.connections[hoveredConnectionIndex];
    if (connection) {
      const currentLabel = typeof connection.label === 'string' ? connection.label : '';
      const boxes = getCardBoxesById();
      const fromBox = boxes.get(connection.from);
      const toBox = boxes.get(connection.to);
      const ep = fromBox && toBox ? getConnectionEndpoints(fromBox, toBox) : { x1: 0, y1: 0, x2: 0, y2: 0 };
      showConnectionPrompt(
        (ep.x1 + ep.x2) / 2,
        (ep.y1 + ep.y2) / 2,
        { mode: 'edit', connectionIndex: hoveredConnectionIndex },
        currentLabel,
      );
    }
    return;
  }

  if (event.key === 'Enter' && selectedItem && selectedItem.type === 'frame') {
    const frameEl = boardSurface.querySelector(`.frame[data-frame-id="${selectedItem.id}"]`);
    if (frameEl) openFrameLabelEditor(frameEl, selectedItem.id);
    return;
  }

  if (event.key === 'Enter' && selectedItem && selectedItem.type === 'card' && currentScope === null && !activeEditor) {
    enterScope(selectedItem.id);
  }
});

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 1) {
    return;
  }
  event.preventDefault();
  canvas.classList.add('canvas--panning');
  const startPanX = panX;
  const startPanY = panY;
  const startX = event.clientX;
  const startY = event.clientY;

  const move = (moveEvent) => {
    panX = startPanX + (moveEvent.clientX - startX);
    panY = startPanY + (moveEvent.clientY - startY);
    applyViewport();
  };

  const finish = () => {
    canvas.classList.remove('canvas--panning');
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', finish);
    canvas.removeEventListener('pointercancel', finish);
  };

  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
});

// JSON inspector
const jsonMinimap = document.getElementById('jsonMinimap');
const jsonMinimapClose = document.getElementById('jsonMinimapClose');
const jsonMinimapContent = document.getElementById('jsonMinimapContent');
const jsonModalBackdrop = document.getElementById('jsonModalBackdrop');
const jsonModal = document.getElementById('jsonModal');
const jsonModalClose = document.getElementById('jsonModalClose');
const jsonModalContent = document.getElementById('jsonModalContent');
const jsonToggleButton = document.getElementById('jsonToggleButton');

function updateJsonInspector(state) {
  const json = serializeBoard(state);
  jsonMinimapContent.textContent = json;
  if (!jsonModal.hidden) {
    jsonModalContent.textContent = json;
  }
}

function openJsonModal() {
  jsonModalContent.textContent = serializeBoard(store.getState());
  jsonModalBackdrop.hidden = false;
  jsonModal.hidden = false;
  jsonModalClose.focus();
}

function closeJsonModal() {
  jsonModal.hidden = true;
  jsonModalBackdrop.hidden = true;
}

function showJsonMinimap() {
  jsonMinimap.hidden = false;
  jsonMinimapContent.textContent = serializeBoard(store.getState());
}

function hideJsonMinimap() {
  jsonMinimap.hidden = true;
  closeJsonModal();
}

jsonMinimap.addEventListener('wheel', (e) => {
  e.stopPropagation();
}, { passive: true });
jsonModal.addEventListener('wheel', (e) => {
  e.stopPropagation();
}, { passive: true });
jsonMinimap.addEventListener('click', (e) => {
  if (e.target === jsonMinimapClose || jsonMinimapClose.contains(e.target)) return;
  openJsonModal();
});
jsonMinimap.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openJsonModal(); }
});
jsonMinimapClose.addEventListener('click', (e) => {
  e.stopPropagation();
  hideJsonMinimap();
});
jsonToggleButton.addEventListener('click', () => {
  if (jsonMinimap.hidden) {
    showJsonMinimap();
  } else {
    hideJsonMinimap();
  }
});
jsonModalClose.addEventListener('click', closeJsonModal);
jsonModalBackdrop.addEventListener('click', closeJsonModal);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !jsonModal.hidden) closeJsonModal();
});

store.onChange(updateJsonInspector);

// Live-server integration (active when served via Python, no-op via file://).
(function initLiveServer() {
  let fromSSE = false;
  let boardLoaded = false;

  function applyExternalBoard(data) {
    let board;
    try { board = validateBoard(data); } catch { return; }
    closeEditor(false);
    fromSSE = true;
    store.setBoard(board);
    if (!boardLoaded) { boardLoaded = true; showBoard(board.id); }
  }

  function enableLiveMode() {
    store.onChange((state) => {
      if (fromSSE) { fromSSE = false; return; }
      fetch('/board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serializeBoard(state),
      }).catch(() => {});
    });

    const es = new EventSource('/events');
    es.addEventListener('message', (e) => {
      try { applyExternalBoard(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
    });
  }

  showBlankCanvas();
  fetch('/board')
    .then((r) => {
      enableLiveMode();
      fetch('/meta')
        .then((r) => r.ok ? r.json() : null)
        .then((meta) => {
          if (!meta || !meta.path) return;
          const parts = meta.path.replace(/\\/g, '/').split('/');
          const filename = parts[parts.length - 1];
          boardPath.textContent = filename;
          boardPath.title = meta.path;
          boardPath.hidden = false;
          boardPathSep.hidden = false;
          openFolderButton.hidden = false;
        })
        .catch(() => {});
      return r.ok ? r.json() : null;
    })
    .then((data) => {
      if (data) {
        applyExternalBoard(data);
      } else {
        /* board.json missing — leave blank canvas */
      }
    })
    .catch(() => {});
}());
