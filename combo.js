// Dropdown with fuzzy search (ARIA combobox), shared by the repository and assignee fields.
// Clicking the field or ▾ shows every option; typing filters them. The list closes after a pick.
import { fuzzyMatch } from './fuzzy.js';

// opts:
//   input, listbox, toggle, container  the elements (container holds all three)
//   items()            current options, in display order when nothing is typed
//   onPick(value)      called after the list closes
//   onEnter(text)      optional: Enter with nothing highlighted (e.g. accept a typed value)
//   emptyText(query)   text for an empty list
//   isCurrent(value)   optional: mark the current choice with a tick
//   pinned             optional: how many leading items to separate from the rest when nothing is typed
export function createCombo(opts) {
  const { input, listbox, toggle, container } = opts;
  let matches = [];
  let active = -1;
  let typed = false; // filter only by what was typed since opening, not by a value already in the field

  const isOpen = () => !listbox.hidden;

  function render() {
    const q = typed ? input.value.trim() : '';
    matches = opts.items().map((value) => ({ value, m: fuzzyMatch(q, value) })).filter((x) => x.m);
    if (q) matches.sort((a, b) => b.m.score - a.m.score);
    active = q && matches.length ? 0 : -1;

    const items = matches.map(({ value, m }, i) => {
      const li = document.createElement('li');
      li.id = `${listbox.id}-${i}`;
      li.setAttribute('role', 'option');
      li.dataset.value = value;
      if (opts.isCurrent?.(value)) li.classList.add('current');
      if (!q && opts.pinned && i === opts.pinned - 1 && matches.length > opts.pinned) li.classList.add('group-end');
      li.append(...(q ? [...value].map((c, k) => (m.positions.includes(k)
        ? Object.assign(document.createElement('mark'), { textContent: c }) : c)) : [value]));
      return li;
    });
    if (!items.length) {
      items.push(Object.assign(document.createElement('li'), { className: 'empty', textContent: opts.emptyText(q) }));
    }
    listbox.replaceChildren(...items);
    showActive();
  }

  function showActive() {
    const items = [...listbox.children];
    items.forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', items[active].id);
      items[active].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function open() {
    render();
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    typed = false;
  }

  function choose(value) {
    close();
    opts.onPick(value);
  }

  input.addEventListener('input', () => { typed = true; open(); });
  input.addEventListener('click', () => { if (!isOpen()) open(); });
  input.addEventListener('keydown', (e) => {
    const n = matches.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen()) open();
        else if (n) active = Math.min(active + 1, n - 1);
        if (active < 0 && n) active = 0;
        showActive();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (isOpen() && n) { active = Math.max(active - 1, 0); showActive(); }
        break;
      case 'Enter':
        e.preventDefault(); // never submit the form from a dropdown
        if (isOpen() && active >= 0) choose(matches[active].value);
        else if (opts.onEnter) { close(); opts.onEnter(input.value.trim()); }
        break;
      case 'Escape':
        if (isOpen()) { e.preventDefault(); close(); }
        break;
    }
  });
  toggle.addEventListener('click', () => {
    if (isOpen()) close();
    else { open(); input.focus(); }
  });
  // mousedown keeps focus in the input; click picks
  listbox.addEventListener('mousedown', (e) => e.preventDefault());
  listbox.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-value]');
    if (li) choose(li.dataset.value);
  });
  document.addEventListener('click', (e) => {
    if (isOpen() && !container.contains(e.target)) close();
  });

  return { open, close, isOpen, refresh: () => { if (isOpen()) render(); } };
}
