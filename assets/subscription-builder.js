/*
 * <sub-box-builder> — Passport Box plan builder (sections/subscription-box.liquid)
 *
 * Plans
 *   multi  : any number of single-flavor boxes per month (one cart line per flavor)
 *   rotate : one box per month on the "Rotating" variant; the chosen flavors and
 *            their order are saved as line item properties for fulfillment.
 */
(() => {
  if (customElements.get('sub-box-builder')) return;

  const formatMoney = (cents, format) => {
    const fmt = format || '${{amount}}';
    const value = (Number(cents) || 0) / 100;
    const withDelims = (n, decimals, thousands, decimal) => {
      const [whole, frac] = n.toFixed(decimals).split('.');
      const w = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      return frac ? `${w}${decimal}${frac}` : w;
    };
    return fmt.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
      switch (key) {
        case 'amount_no_decimals':
          return withDelims(value, 0, ',', '.');
        case 'amount_with_comma_separator':
          return withDelims(value, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator':
          return withDelims(value, 0, '.', ',');
        case 'amount_with_apostrophe_separator':
          return withDelims(value, 2, "'", '.');
        default:
          return withDelims(value, 2, ',', '.');
      }
    });
  };

  const fill = (template, values) =>
    String(template || '').replace(/\[(\w+)\]/g, (m, k) => (k in values ? values[k] : m));

  class SubBoxBuilder extends HTMLElement {
    connectedCallback() {
      try {
        this.data = JSON.parse(this.querySelector('[data-builder-data]').textContent);
        this.strings = JSON.parse(this.querySelector('[data-builder-strings]').textContent);
      } catch (e) {
        console.error('[sub-box-builder] bad data', e);
        return;
      }
      this.flavors = (this.data.flavors || []).filter((f) => f && f.id);
      this.counts = new Map(this.flavors.map((f) => [f.id, 0]));
      this.rotation = [];
      this.plan = 'multi';
      this.featured = this.flavors[0] || null;

      const root = this.closest('.sub-box') || document;
      this.visual = root.querySelector('[data-box-visual]');
      this.submit = this.querySelector('[data-builder-submit]');
      this.errorEl = this.querySelector('[data-builder-error]');

      // Start with one box of the first available flavor so the price shows.
      const firstAvailable = this.flavors.find((f) => f.available) || this.flavors[0];
      if (firstAvailable) this.counts.set(firstAvailable.id, 1);

      this.renderMulti();
      this.renderRotate();

      this.querySelectorAll(`input[name^="plan-"]`).forEach((input) => {
        input.addEventListener('change', () => {
          if (!input.checked) return;
          this.plan = input.value;
          this.querySelectorAll('[data-panel]').forEach((p) => {
            p.hidden = p.dataset.panel !== this.plan;
          });
          this.update();
        });
      });

      if (this.submit) this.submit.addEventListener('click', () => this.addToCart());
      this.update();
    }

    /* ---------- Multi-box plan ---------- */
    renderMulti() {
      const list = this.querySelector('[data-multi-list]');
      if (!list) return;
      list.innerHTML = '';
      this.flavors.forEach((f) => {
        const li = document.createElement('li');
        li.className = 'sub-box__flavor';
        li.style.setProperty('--flavor-color', f.color);
        if (!f.available) li.classList.add('is-unavailable');
        li.innerHTML = `
          <span class="sub-box__flavor-dot" aria-hidden="true"></span>
          <span class="sub-box__flavor-name">
            <span class="sub-box__flavor-title"></span>
            <span class="sub-box__flavor-place"></span>
          </span>
          <span class="sub-box__stepper">
            <button type="button" class="sub-box__step-btn" data-dir="-1" aria-label="">−</button>
            <output class="sub-box__count" aria-live="polite">0</output>
            <button type="button" class="sub-box__step-btn" data-dir="1" aria-label="">+</button>
          </span>`;
        li.querySelector('.sub-box__flavor-title').textContent = f.title;
        li.querySelector('.sub-box__flavor-place').textContent = [f.place, f.country].filter(Boolean).join(', ');
        const [minus, plus] = li.querySelectorAll('.sub-box__step-btn');
        minus.setAttribute('aria-label', `Remove a ${f.title} box`);
        plus.setAttribute('aria-label', `Add a ${f.title} box`);
        li.querySelectorAll('.sub-box__step-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const next = Math.max(0, Math.min(this.data.maxPerFlavor || 4, this.counts.get(f.id) + Number(btn.dataset.dir)));
            this.counts.set(f.id, next);
            if (next > 0) this.featured = f;
            this.update();
          });
        });
        li.dataset.id = f.id;
        list.appendChild(li);
      });
    }

    /* ---------- Rotating plan ---------- */
    renderRotate() {
      const chips = this.querySelector('[data-rotate-chips]');
      if (!chips) return;
      chips.innerHTML = '';
      this.flavors.forEach((f) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sub-box__chip';
        b.style.setProperty('--flavor-color', f.color);
        b.dataset.id = f.id;
        b.setAttribute('aria-pressed', 'false');
        b.disabled = !f.available;
        b.innerHTML = '<span class="sub-box__chip-order" aria-hidden="true"></span><span class="sub-box__chip-label"></span>';
        b.querySelector('.sub-box__chip-label').textContent = f.title;
        b.addEventListener('click', () => {
          const i = this.rotation.indexOf(f.id);
          if (i === -1) {
            this.rotation.push(f.id);
            this.featured = f;
          } else {
            this.rotation.splice(i, 1);
          }
          this.update();
        });
        chips.appendChild(b);
      });
    }

    flavorById(id) {
      return this.flavors.find((f) => f.id === id);
    }

    totals() {
      if (this.plan === 'rotate') {
        const price = this.data.rotating ? this.data.rotating.price : 0;
        return { boxes: this.rotation.length ? 1 : 0, price: this.rotation.length ? price : 0 };
      }
      let boxes = 0;
      let price = 0;
      this.flavors.forEach((f) => {
        const n = this.counts.get(f.id) || 0;
        boxes += n;
        price += n * f.price;
      });
      return { boxes, price };
    }

    update() {
      // Multi steppers
      this.querySelectorAll('.sub-box__flavor').forEach((li) => {
        const n = this.counts.get(Number(li.dataset.id)) || 0;
        li.querySelector('.sub-box__count').textContent = n;
        li.classList.toggle('is-selected', n > 0);
        const [minus, plus] = li.querySelectorAll('.sub-box__step-btn');
        minus.disabled = n === 0;
        plus.disabled = n >= (this.data.maxPerFlavor || 4) || li.classList.contains('is-unavailable');
      });

      // Rotation chips + schedule
      this.querySelectorAll('.sub-box__chip').forEach((chip) => {
        const i = this.rotation.indexOf(Number(chip.dataset.id));
        chip.setAttribute('aria-pressed', String(i !== -1));
        chip.querySelector('.sub-box__chip-order').textContent = i === -1 ? '+' : String(i + 1);
      });
      const schedule = this.querySelector('[data-rotate-schedule]');
      if (schedule) {
        schedule.innerHTML = '';
        this.rotation.forEach((id, i) => {
          const f = this.flavorById(id);
          if (!f) return;
          const li = document.createElement('li');
          li.style.setProperty('--flavor-color', f.color);
          li.innerHTML = '<span class="sub-box__month"></span><span class="sub-box__month-flavor"></span>';
          li.querySelector('.sub-box__month').textContent = fill(this.strings.month, { n: i + 1 });
          li.querySelector('.sub-box__month-flavor').textContent = f.title;
          schedule.appendChild(li);
        });
      }

      // Summary
      const { boxes, price } = this.totals();
      const boxesEl = this.querySelector('[data-summary-boxes]');
      const priceEl = this.querySelector('[data-summary-price]');
      if (boxes === 0) {
        boxesEl.textContent = this.plan === 'rotate' ? this.strings.empty_rotate : this.strings.empty_multi;
        priceEl.textContent = '';
      } else {
        boxesEl.textContent = boxes === 1 ? this.strings.boxes_one : fill(this.strings.boxes_other, { count: boxes });
        priceEl.textContent = fill(this.strings.per_month, { price: formatMoney(price, this.data.moneyFormat) });
      }
      if (this.submit) this.submit.disabled = boxes === 0;

      // Box illustration shows the featured flavor
      if (this.plan === 'rotate' && this.rotation.length) this.featured = this.flavorById(this.rotation[0]) || this.featured;
      if (this.plan === 'multi' && (this.counts.get(this.featured && this.featured.id) || 0) === 0) {
        this.featured = this.flavors.find((f) => (this.counts.get(f.id) || 0) > 0) || this.featured;
      }
      this.paintBox();
    }

    paintBox() {
      if (!this.featured) return;
      const f = this.featured;
      const root = this.closest('.sub-box') || document;
      const photo = root.querySelector('[data-box-photo]');
      if (photo) {
        if (f.image) {
          if (photo.getAttribute('src') !== f.image) {
            photo.classList.remove('is-shown');
            photo.onload = () => photo.classList.add('is-shown');
            photo.src = f.image;
            if (photo.complete) photo.classList.add('is-shown');
          }
          photo.alt = f.imageAlt || f.title;
          photo.hidden = false;
          if (this.visual) this.visual.hidden = true;
          return;
        }
        photo.hidden = true;
      }
      if (!this.visual) return;
      this.visual.hidden = false;
      this.visual.querySelectorAll('[data-box-bar]').forEach((bar) => {
        bar.style.setProperty('--bar-color', f.color);
        const place = bar.querySelector('[data-box-place]');
        const code = bar.querySelector('[data-box-code]');
        if (place) place.textContent = f.place || f.title;
        if (code) code.textContent = f.code || '';
      });
      const caption = this.visual.querySelector('[data-box-caption]');
      if (caption) caption.textContent = `${this.data.barCount} × ${f.title}`;
    }

    /* ---------- Cart ---------- */
    buildItems() {
      const sellingPlan = this.data.sellingPlan;
      if (this.plan === 'rotate') {
        if (!this.data.rotating || !this.rotation.length) return [];
        const names = this.rotation.map((id) => this.flavorById(id)).filter(Boolean).map((f) => f.title);
        const item = {
          id: this.data.rotating.id,
          quantity: 1,
          properties: {
            Plan: this.strings.plan_rotate,
            Rotation: names.map((n, i) => `${i + 1}. ${n}`).join(' → '),
            'First box': names[0],
          },
        };
        if (sellingPlan) item.selling_plan = sellingPlan;
        return [item];
      }
      return this.flavors
        .filter((f) => (this.counts.get(f.id) || 0) > 0)
        .map((f) => {
          const item = { id: f.id, quantity: this.counts.get(f.id), properties: { Plan: this.strings.plan_multi } };
          if (sellingPlan) item.selling_plan = sellingPlan;
          return item;
        });
    }

    async addToCart() {
      const items = this.buildItems();
      if (!items.length || !this.submit) return;
      const label = this.submit.textContent;
      this.submit.disabled = true;
      this.submit.textContent = this.strings.adding;
      if (this.errorEl) this.errorEl.hidden = true;
      try {
        const res = await fetch(this.data.cartAddUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.description || body.message || res.statusText);
        }
        window.location.href = this.data.cartUrl;
      } catch (err) {
        console.error('[sub-box-builder]', err);
        if (this.errorEl) {
          this.errorEl.textContent = this.strings.error;
          this.errorEl.hidden = false;
        }
        this.submit.textContent = label;
        this.submit.disabled = false;
      }
    }
  }

  customElements.define('sub-box-builder', SubBoxBuilder);
})();
