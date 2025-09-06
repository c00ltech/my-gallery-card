/* my-gallery-card.js
   Detection Shots Gallery - HACS friendly ES module
   Place via HACS (Frontend) or copy to /config/www/my-gallery-card/
*/

class DetectionShotsGallery extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this.attachShadow({ mode: 'open' });
    this.path = null;
    this.limit = 0;
    this.refreshInterval = 0;
    this._items = [];
    this._timer = null;
  }

  setConfig(config) {
    config = config || {};
    this.path = config.path || this.getAttribute('path') || 'media-source://media_source/local/detection_shots';
    this.limit = Number(config.limit || this.getAttribute('limit') || 0);
    this.refreshInterval = Number(config.refresh || this.getAttribute('refresh') || 0);
    if (!this.shadowRoot.innerHTML) this._renderPlaceholder();
  }

  connectedCallback() {
    // no-op
  }

  set hass(hass) {
    this._hass = hass;
    // avoid double setup
    if (!this._initialized) {
      this._initialized = true;
      this._fetchAndRender();
      if (this.refreshInterval > 0) {
        this._timer = setInterval(() => this._fetchAndRender(), this.refreshInterval * 1000);
      }
    } else {
      // update if resources changed
      this._fetchAndRender();
    }
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer);
  }

  getCardSize() { return 6; }

  async _fetchMediaList() {
    if (!this._hass) return [];
    try {
      const res = await this._hass.callApi('GET', `/media_player/browse_media?media_content_type=directory&media_content_id=${encodeURIComponent(this.path)}`);
      const children = res.children || res.media_content_children || [];
      const images = children
        .filter(c => c.media_content_type && c.media_content_type.startsWith('image'))
        .map(c => ({
          name: c.title || c.name || '',
          id: c.media_content_id,
          created: c.media_created || c.media_modified || 0,
          raw: c
        }));
      return images;
    } catch (err) {
      console.error('DetectionShotsGallery: fetch error', err);
      return [];
    }
  }

  async _fetchAndRender() {
    const items = await this._fetchMediaList();
    items.forEach(it => {
      if (!it.created || it.created === 0) {
        const m = (it.name || '').match(/(\d{4}[-_]?\d{2}[-_]?\d{2}[_-]?\d{6,})/);
        it.created = m ? (Date.parse(m[1]) || 0) : 0;
      }
    });
    items.sort((a,b) => (b.created||0) - (a.created||0));
    this._items = this.limit > 0 ? items.slice(0, this.limit) : items;
    this._render();
  }

  _renderPlaceholder() {
    this.shadowRoot.innerHTML = `<div style="padding:12px">Loading gallery…</div><div id="modal-root"></div>`;
  }

  _render() {
    const style = `
      :host{display:block;font-family:Roboto,Arial,Helvetica,sans-serif;}
      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;}
      .tile{position:relative;overflow:hidden;border-radius:6px;background:#f0f0f0;cursor:pointer;height:120px;display:flex;align-items:center;justify-content:center;}
      .tile img{width:100%;height:100%;object-fit:cover;display:block;}
      .overlay{position:absolute;right:6px;top:6px;background:rgba(0,0,0,0.45);color:#fff;font-size:12px;padding:4px 6px;border-radius:4px;}
      .modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);z-index:1000;}
      .modal-content{max-width:95vw;max-height:95vh;background:#111;border-radius:6px;padding:8px;display:flex;flex-direction:column;align-items:center;}
      .modal img{max-width:90vw;max-height:80vh;object-fit:contain;}
      .actions{margin-top:8px;display:flex;gap:8px;}
      .btn{background:var(--primary-color);color:#fff;padding:8px 10px;border-radius:6px;cursor:pointer;border:none;font-size:14px;}
      .btn.secondary{background:rgba(255,255,255,0.12);}
      .empty{padding:12px;color:var(--secondary-text-color);}
    `;
    const content = `
      <style>${style}</style>
      <div class="grid">
        ${this._items.length === 0 ? `<div class="empty">No images found.</div>` : this._items.map(it => `
          <div class="tile" data-id="${escapeHtml(it.id)}" title="${escapeHtml(it.name||'')}">
            <img src="${escapeAttr(this._getPublicUrl(it.id))}" loading="lazy" />
            <div class="overlay">${formatDateShort(it.created)}</div>
          </div>`).join('')}
      </div>
      <div id="modal-root"></div>
    `;
    this.shadowRoot.innerHTML = content;
    this.shadowRoot.querySelectorAll('.tile').forEach(el => {
      el.addEventListener('click', () => this._openModal(el.getAttribute('data-id'), el.getAttribute('title')));
    });
  }

  _getPublicUrl(mediaId) {
    if (!mediaId) return '';
    if (mediaId.startsWith('/api/')) return mediaId;
    return `/api/media_source_proxy/media_content?media_content_id=${encodeURIComponent(mediaId)}`;
  }

  async _openModal(mediaId, title) {
    const root = this.shadowRoot.getElementById('modal-root');
    if (!root) return;
    const imageUrl = this._getPublicUrl(mediaId);
    root.innerHTML = `
      <div class="modal" id="modal">
        <div class="modal-content">
          <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(title||'')}" />
          <div class="actions">
            <button class="btn" id="downloadBtn">Download</button>
            <button class="btn secondary" id="closeBtn">Close</button>
          </div>
        </div>
      </div>
    `;
    const modal = root.querySelector('#modal');
    modal.addEventListener('click', (ev) => { if (ev.target === modal) this._closeModal(); });
    root.querySelector('#closeBtn').addEventListener('click', () => this._closeModal());
    root.querySelector('#downloadBtn').addEventListener('click', () => this._downloadImage(imageUrl, title || 'image'));
  }

  _closeModal() { const root = this.shadowRoot.getElementById('modal-root'); if (root) root.innerHTML = ''; }

  async _downloadImage(url, filenameBase) {
    try {
      const resp = await fetch(url, { credentials: 'same-origin' });
      const blob = await resp.blob();
      const urlBlob = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = urlBlob;
      const safeName = (filenameBase || 'image').replace(/[^a-z0-9_\\-\\.]/gi, '_');
      a.download = `${safeName}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(urlBlob);
    } catch (err) {
      console.error('Download failed', err);
      alert('Download failed');
    }
  }
}

function escapeHtml(s){ if(!s) return ''; return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]); }
function escapeAttr(s){ return escapeHtml(s); }
function formatDateShort(ts){ if(!ts) return ''; const t=(typeof ts==='number')?ts:Date.parse(ts); if(!t) return ''; const d=new Date(t); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function pad(n){ return n<10? '0'+n:String(n); }

customElements.define('detection-shots-gallery', DetectionShotsGallery);
export default DetectionShotsGallery;
