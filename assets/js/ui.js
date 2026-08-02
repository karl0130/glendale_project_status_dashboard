// 공용 UI 조각: 툴팁 · 토스트 · 모달 폼.

import { escapeHtml } from './util.js';

export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

// ── 툴팁 ────────────────────────────────────────────────────────────────────
// 차트 위 요소는 hover와 focus 모두에서 같은 내용을 보여준다.
// 툴팁은 값을 읽는 "유일한" 통로가 아니다 — 모든 값은 표 보기에도 그대로 있다.

let tooltipEl = null;

function ensureTooltip() {
  if (!tooltipEl) {
    tooltipEl = el('div', 'tooltip');
    tooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function showTooltip(html, x, y) {
  const node = ensureTooltip();
  node.innerHTML = html;
  node.classList.add('is-visible');
  const rect = node.getBoundingClientRect();
  const pad = 12;
  let left = x + 14;
  let top = y + 14;
  if (left + rect.width + pad > window.innerWidth) left = x - rect.width - 14;
  if (top + rect.height + pad > window.innerHeight) top = y - rect.height - 14;
  node.style.left = `${Math.max(pad, left)}px`;
  node.style.top = `${Math.max(pad, top)}px`;
}

export function hideTooltip() {
  if (tooltipEl) tooltipEl.classList.remove('is-visible');
}

/** 마우스·키보드 모두에서 동일하게 동작하는 툴팁 바인딩 */
export function bindTooltip(node, html) {
  node.addEventListener('mouseenter', (e) => showTooltip(html, e.clientX, e.clientY));
  node.addEventListener('mousemove', (e) => showTooltip(html, e.clientX, e.clientY));
  node.addEventListener('mouseleave', hideTooltip);
  node.addEventListener('focus', () => {
    const r = node.getBoundingClientRect();
    showTooltip(html, r.left, r.bottom);
  });
  node.addEventListener('blur', hideTooltip);
}

// ── 토스트 ──────────────────────────────────────────────────────────────────

let toastTimer = null;

export function toast(message, tone = 'info') {
  let node = document.querySelector('.toast');
  if (!node) {
    node = el('div', 'toast');
    node.setAttribute('role', 'status');
    document.body.appendChild(node);
  }
  node.className = `toast toast--${tone} is-visible`;
  node.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), 2800);
}

// ── 모달 폼 ─────────────────────────────────────────────────────────────────
//
// fields: [{ name, label, type, options, required, hint, value, colspan }]
//   type: text | textarea | date | select | multiselect | readonly

/**
 * onDelete 를 넘기면 푸터 왼쪽에 삭제 버튼이 생긴다 (수정 모드에서만 넘길 것).
 * 확인 대화상자는 호출부가 띄운다 — 무엇을 지우는지 아는 쪽이 거기이기 때문이다.
 * onDelete 가 false 를 돌려주면(사용자가 취소) 폼을 닫지 않는다.
 */
export function openForm({
  title,
  subtitle,
  fields,
  values = {},
  submitLabel = '저장',
  onSubmit,
  onDelete = null,
  deleteLabel = '삭제',
}) {
  const backdrop = el('div', 'modal-backdrop');
  const modal = el('div', 'modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', title);

  modal.innerHTML = `
    <header class="modal__head">
      <div>
        <h2 class="modal__title">${escapeHtml(title)}</h2>
        ${subtitle ? `<p class="modal__sub">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      <button type="button" class="icon-btn" data-close aria-label="닫기">✕</button>
    </header>
    <form class="modal__form" novalidate>
      <div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.name])).join('')}</div>
      <p class="form-error" data-error hidden></p>
      <footer class="modal__foot">
        ${onDelete ? `<button type="button" class="btn btn--danger-ghost" data-delete>${escapeHtml(deleteLabel)}</button>` : ''}
        <div class="modal__foot-actions">
          <button type="button" class="btn" data-close>취소</button>
          <button type="submit" class="btn btn--primary">${escapeHtml(submitLabel)}</button>
        </div>
      </footer>
    </form>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  document.body.classList.add('is-modal-open');

  const form = modal.querySelector('form');
  const errorEl = modal.querySelector('[data-error]');

  function close() {
    document.body.classList.remove('is-modal-open');
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

  modal.querySelector('[data-delete]')?.addEventListener('click', () => {
    try {
      if (onDelete() === false) return; // 호출부의 확인 대화상자에서 취소함
      close();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {};
    for (const field of fields) {
      if (field.type === 'multiselect') {
        data[field.name] = [...form.querySelectorAll(`input[name="${field.name}"]:checked`)].map(
          (i) => i.value
        );
      } else if (field.type !== 'readonly') {
        data[field.name] = form.elements[field.name]?.value?.trim() ?? '';
      }
    }
    const missing = fields.find(
      (f) => f.required && (Array.isArray(data[f.name]) ? !data[f.name].length : !data[f.name])
    );
    if (missing) {
      errorEl.textContent = `'${missing.label}' 항목은 필수입니다.`;
      errorEl.hidden = false;
      form.elements[missing.name]?.focus?.();
      return;
    }
    try {
      onSubmit(data);
      close();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  form.querySelector('input, select, textarea')?.focus();
  return close;
}

function fieldHtml(field, value) {
  const v = value ?? field.value ?? '';
  const span = field.colspan === 2 ? ' form-row--wide' : '';
  const req = field.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
  const hint = field.hint ? `<span class="form-hint">${escapeHtml(field.hint)}</span>` : '';
  let control = '';

  switch (field.type) {
    case 'textarea':
      control = `<textarea name="${field.name}" rows="${field.rows ?? 4}">${escapeHtml(v)}</textarea>`;
      break;
    case 'select':
      control = `<select name="${field.name}">
        ${field.allowEmpty ? '<option value="">선택 안 함</option>' : ''}
        ${field.options
          .map(
            (o) =>
              `<option value="${escapeHtml(o.value)}"${o.value === v ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
          )
          .join('')}
      </select>`;
      break;
    case 'multiselect': {
      const selected = Array.isArray(v) ? v : [];
      control = `<div class="checks">
        ${field.options
          .map(
            (o) => `<label class="check">
              <input type="checkbox" name="${field.name}" value="${escapeHtml(o.value)}"${selected.includes(o.value) ? ' checked' : ''}>
              <span>${escapeHtml(o.label)}</span>
            </label>`
          )
          .join('')}
      </div>`;
      break;
    }
    case 'date':
      control = `<input type="date" name="${field.name}" value="${escapeHtml(v)}">`;
      break;
    case 'readonly':
      control = `<p class="form-readonly">${escapeHtml(v)}</p>`;
      break;
    default:
      control = `<input type="text" name="${field.name}" value="${escapeHtml(v)}" placeholder="${escapeHtml(field.placeholder ?? '')}">`;
  }

  return `<div class="form-row${span}">
    <label class="form-label" for="${field.name}">${escapeHtml(field.label)}${req}</label>
    ${control}
    ${hint}
  </div>`;
}

export function confirmDialog(message) {
  return window.confirm(message);
}
