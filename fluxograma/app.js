const DEFAULT_URL = document.querySelector('#csvUrl').value;
const svg = document.querySelector('#diagram');
const canvas = document.querySelector('#canvasWrap');
const emptyState = document.querySelector('#emptyState');
const status = document.querySelector('#status');
const statusText = document.querySelector('#statusText');
const searchInput = document.querySelector('#searchInput');
const tooltip = document.querySelector('#tooltip');
const details = document.querySelector('#details');
let graph = { nodes: [], edges: [] };
let view = { scale: 10, x: 0, y: 0 };
let drag = null;
let suppressNodeClick = false;
let selectedNodeElement = null;

function showToast(message) { const toast = document.querySelector('#toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500); }
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function parseCsv(text) {
  const rows = []; let row = []; let value = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) { const char = text[index]; const next = text[index + 1];
    if (char === '"' && quoted && next === '"') { value += '"'; index += 1; } else if (char === '"') quoted = !quoted; else if ((char === ',' || char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') index += 1; row.push(value); value = ''; if (char !== ',') { rows.push(row); row = []; } } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift().map(header => header.trim().toLowerCase());
  return rows.filter(item => item.some(cell => cell.trim())).map(item => Object.fromEntries(headers.map((header, i) => [header, (item[i] || '').trim()])));
}
function cleanLabel(label) { return label.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#039;/g, "'"); }
function makeGraph(rows) {
  const nodes = rows.filter(row => row.id && row.label).map(row => ({ id: row.id, label: cleanLabel(row.label), row }));
  const ids = new Set(nodes.map(node => node.id)); const edges = [];
  nodes.forEach(node => ['pai', 'sim', 'nao'].forEach(type => { const from = node.row[type]; if (from && ids.has(from)) edges.push({ from, to: node.id, label: type === 'sim' ? 'Sim' : type === 'nao' ? 'Não' : '' }); }));
  return { nodes, edges };
}
function textLines(text, maxChars = 31) { const words = text.split(/\s+/); const lines = []; let line = ''; words.forEach(word => { if ((line + ' ' + word).trim().length > maxChars && line) { lines.push(line); line = word; } else line = (line + ' ' + word).trim(); }); if (line) lines.push(line); return lines.slice(0, 7); }
function layoutGraph() {
  const incoming = new Map(graph.nodes.map(node => [node.id, []]));
  const children = new Map(graph.nodes.map(node => [node.id, []]));
  graph.edges.forEach(edge => { incoming.get(edge.to)?.push(edge.from); children.get(edge.from)?.push(edge.to); });
  const gapX = 70; const gapY = 190; const nodeW = 238; const positions = new Map();
  const roots = graph.nodes.filter(node => !(incoming.get(node.id) || []).length);
  const visited = new Set();
  const measure = (id, stack = new Set()) => {
    if (stack.has(id)) return 1;
    const nextStack = new Set(stack); nextStack.add(id);
    const branches = (children.get(id) || []).filter(child => !visited.has(child));
    return branches.length ? branches.reduce((total, child) => total + measure(child, nextStack), 0) : 1;
  };
  const place = (id, left, depth, stack = new Set()) => {
    if (stack.has(id) || visited.has(id)) return left;
    visited.add(id); const node = graph.nodes.find(item => item.id === id); const lines = textLines(node.label); const height = Math.max(54, lines.length * 16 + 23);
    const branches = (children.get(id) || []).filter(child => !visited.has(child));
    const width = Math.max(1, branches.reduce((total, child) => total + measure(child), 0));
    const childStart = branches.length ? left : left + 0.5;
    let childCursor = childStart;
    branches.forEach(child => { const childWidth = measure(child); place(child, childCursor, depth + 1, new Set([...stack, id])); childCursor += childWidth; });
    const center = branches.length ? (childStart + childCursor - 1) / 2 : left;
    positions.set(id, { x: center * (nodeW + gapX), y: depth * gapY, width: nodeW, height, lines, depth });
    return left + width;
  };
  let cursor = 0; roots.forEach(root => { cursor = place(root.id, cursor, 0); });
  graph.nodes.filter(node => !visited.has(node.id)).forEach(node => { cursor = place(node.id, cursor, 0); });
  const center = [...positions.values()].reduce((sum, position) => sum + position.x, 0) / positions.size;
  positions.forEach(position => { position.x -= center; });
  return positions;
}
function render() {
  if (!graph.nodes.length) return; const positions = layoutGraph(); const all = [...positions.values()]; const minX = Math.min(...all.map(p => p.x - p.width / 2)) - 50; const maxX = Math.max(...all.map(p => p.x + p.width / 2)) + 50; const maxY = Math.max(...all.map(p => p.y + p.height)) + 80;
  svg.setAttribute('viewBox', `${minX} -50 ${maxX - minX} ${maxY + 50}`); svg.innerHTML = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8c9991"/></marker></defs>`;
  const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g'); const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g'); svg.append(edgeLayer, nodeLayer); const nodeMap = new Map(graph.nodes.map(node => [node.id, node]));
  graph.edges.forEach(edge => { const from = positions.get(edge.from); const to = positions.get(edge.to); if (!from || !to) return; const startX = from.x, startY = from.y + from.height / 2; const endX = to.x, endY = to.y - to.height / 2; const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('class', 'edge'); path.setAttribute('marker-end', 'url(#arrow)'); path.setAttribute('d', `M ${startX} ${startY} C ${startX} ${startY + 45}, ${endX} ${endY - 45}, ${endX} ${endY}`); edgeLayer.append(path); if (edge.label) { const label = document.createElementNS('http://www.w3.org/2000/svg', 'text'); label.setAttribute('class', 'edge-label'); label.setAttribute('x', (startX + endX) / 2 + (startX < endX ? 10 : -28)); label.setAttribute('y', (startY + endY) / 2); label.setAttribute('text-anchor', startX < endX ? 'start' : 'end'); label.setAttribute('style', 'fill:#d4eaf2;font-weight:700;paint-order:stroke;stroke:#111416;stroke-width:5px;stroke-linejoin:round;'); label.textContent = edge.label; edgeLayer.append(label); } });
  graph.nodes.forEach(node => { const p = positions.get(node.id); const group = document.createElementNS('http://www.w3.org/2000/svg', 'g'); const isCategory = node.id === '1' || graph.edges.some(edge => edge.from === '1' && edge.to === node.id); const hasDecisionPaths = graph.edges.some(edge => edge.from === node.id && edge.label); const type = isCategory ? 'root' : hasDecisionPaths ? 'action' : 'question'; group.setAttribute('class', `node ${type}`); group.dataset.id = node.id; group.setAttribute('transform', `translate(${p.x - p.width / 2}, ${p.y - p.height / 2})`); const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); rect.setAttribute('width', p.width); rect.setAttribute('height', p.height); rect.setAttribute('rx', 7); group.append(rect); p.lines.forEach((line, i) => { const text = document.createElementNS('http://www.w3.org/2000/svg', 'text'); text.setAttribute('x', p.width / 2); text.setAttribute('y', 21 + i * 16); text.setAttribute('text-anchor', 'middle'); text.textContent = line; group.append(text); }); group.addEventListener('click', () => { if (!suppressNodeClick) selectNode(node.id, group); suppressNodeClick = false; }); group.addEventListener('mouseenter', event => { tooltip.textContent = node.label; tooltip.style.display = 'block'; const ctm = group.getScreenCTM(); const scaledWidth = 238 * ctm.a; const scaledHeight = 54 * ctm.d; const gap = 4; const nodeRightEdge = ctm.e + scaledWidth; let left = nodeRightEdge + gap + 200 <= window.innerWidth ? nodeRightEdge + gap : ctm.e - 200 - gap; left = Math.max(4, Math.min(left, window.innerWidth - 200 - 4)); const nodeVerticalCenter = ctm.f + scaledHeight / 2; const tooltipHeight = 60; const idealTop = nodeVerticalCenter - tooltipHeight / 2; const top = Math.max(4, Math.min(idealTop, window.innerHeight - tooltipHeight - 4)); tooltip.style.left = `${left}px`; tooltip.style.top = `${top}px`; }); group.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; }); nodeLayer.append(group); }); applyTransform(); }
function incomingFor(id) { return graph.edges.filter(edge => edge.to === id); }
function positionDetails() { if (!selectedNodeElement || !details.classList.contains('open')) return; const svg = document.querySelector('#diagram'); const canvasRect = svg.parentElement.getBoundingClientRect(); const ctm = selectedNodeElement.getScreenCTM(); const nodeWidth = 238; const nodeHeight = 54; const nodeRight = ctm.e + nodeWidth; const nodeTop = ctm.f; const panel = details.getBoundingClientRect(); const gap = 16; const left = nodeRight + gap + panel.width <= window.innerWidth ? nodeRight + gap : ctm.e - panel.width - gap; const top = Math.max(16, Math.min(nodeTop, window.innerHeight - panel.height - 16)); details.style.left = `${Math.max(16, Math.min(left, window.innerWidth - panel.width - 16))}px`; details.style.right = 'auto'; details.style.top = `${top}px`; }
function selectNode(id, element) { document.querySelectorAll('.node').forEach(node => node.classList.toggle('selected', node.dataset.id === id)); const node = graph.nodes.find(item => item.id === id); if (!node) return; selectedNodeElement = element; document.querySelector('#detailTitle').textContent = node.label.split('\n')[0]; document.querySelector('#detailBody').innerHTML = node.label.replace(/\n/g, '<br>'); const outgoing = graph.edges.filter(edge => edge.from === id); document.querySelector('#detailLinks').innerHTML = outgoing.length ? `<div class="path">Próximos caminhos<br>${outgoing.map(edge => `${escapeHtml(edge.label || 'Próximo')} → ${escapeHtml(graph.nodes.find(item => item.id === edge.to)?.label.split('\n')[0] || edge.to)}`).join('<br>')}</div>` : ''; details.classList.add('open'); positionDetails(); }
function applyTransform() { svg.style.transformOrigin = 'center center'; svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`; const label = document.querySelector('#zoomLabel'); if (!label.classList.contains('editing')) label.textContent = `${Math.round(view.scale * 100) / 10}%`; positionDetails(); }
function setZoom(next) { view.scale = Math.max(1, next); applyTransform(); }
function setZoomCentered(next, cx, cy) { const canvasEl = document.querySelector('#canvasWrap'); const rect = canvasEl.getBoundingClientRect(); const centerX = cx ?? rect.width / 2; const centerY = cy ?? rect.height / 2; const scaleRatio = next / view.scale; view.x = centerX - (centerX - view.x) * scaleRatio; view.y = centerY - (centerY - view.y) * scaleRatio; view.scale = Math.max(1, next); applyTransform(); }
function fit() { view = { scale: 10, x: 0, y: 0 }; applyTransform(); }
function editZoomLabel() { const label = document.querySelector('#zoomLabel'); label.classList.add('editing'); const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '1000'; input.value = Math.round(view.scale * 100) / 10; input.className = 'zoom-input'; label.textContent = ''; label.appendChild(input); input.focus(); input.select(); const commit = () => { const value = parseFloat(input.value); if (!isNaN(value) && value >= 1) { setZoom(value / 10); } label.classList.remove('editing'); }; input.addEventListener('blur', commit); input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } else if (e.key === 'Escape') { e.preventDefault(); label.classList.remove('editing'); applyTransform(); } }); }
async function loadCsv() { const button = document.querySelector('#loadButton'); button.disabled = true; statusText.textContent = 'Carregando planilha...'; try { const response = await fetch(document.querySelector('#csvUrl').value.trim() || DEFAULT_URL); if (!response.ok) throw new Error(`HTTP ${response.status}`); graph = makeGraph(parseCsv(await response.text())); if (!graph.nodes.length) throw new Error('Nenhum nó encontrado'); document.querySelector('#nodeCount').textContent = graph.nodes.length; document.querySelector('#edgeCount').textContent = graph.edges.length; searchInput.disabled = false; emptyState.classList.add('hidden'); status.classList.add('loaded'); statusText.textContent = 'Planilha sincronizada'; fit(); render(); } catch (error) { status.classList.remove('loaded'); statusText.textContent = 'Falha ao carregar'; showToast(`Não foi possível carregar o CSV: ${error.message}`); } finally { button.disabled = false; } }
document.querySelector('#loadButton').addEventListener('click', loadCsv); document.querySelector('#zoomLabel').addEventListener('click', editZoomLabel); document.querySelector('#fitButton').addEventListener('click', fit); document.querySelector('#zoomInButton').addEventListener('click', () => setZoom(view.scale + 1)); document.querySelector('#zoomOutButton').addEventListener('click', () => setZoom(view.scale - 1)); document.querySelector('#closeDetails').addEventListener('click', () => details.classList.remove('open')); searchInput.addEventListener('input', event => { const query = event.target.value.toLowerCase(); document.querySelectorAll('.node').forEach(node => { const item = graph.nodes.find(value => value.id === node.dataset.id); node.style.opacity = query && !item.label.toLowerCase().includes(query) ? '.18' : '1'; }); });
document.addEventListener('keydown', event => { if (!event.ctrlKey || event.altKey || event.metaKey) return; if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoomCentered(view.scale + 1); } else if (event.key === '-') { event.preventDefault(); setZoomCentered(view.scale - 1); } }); canvas.addEventListener('wheel', event => { event.preventDefault(); if (event.ctrlKey) { const rect = canvas.getBoundingClientRect(); setZoomCentered(view.scale + (event.deltaY < 0 ? 1 : -1), event.clientX - rect.left, event.clientY - rect.top); } else { view.y -= event.deltaY * 0.5; applyTransform(); } }, { passive: false }); canvas.addEventListener('selectstart', event => event.preventDefault()); canvas.addEventListener('pointerdown', event => { drag = { x: event.clientX - view.x, y: event.clientY - view.y, startX: event.clientX, startY: event.clientY, moved: false }; suppressNodeClick = false; canvas.setPointerCapture(event.pointerId); }); canvas.addEventListener('pointermove', event => { if (!drag) return; if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true; view.x = event.clientX - drag.x; view.y = event.clientY - drag.y; applyTransform(); }); canvas.addEventListener('pointerup', () => { if (drag) suppressNodeClick = drag.moved; drag = null; }); canvas.addEventListener('pointercancel', () => { drag = null; suppressNodeClick = true; });
loadCsv();
