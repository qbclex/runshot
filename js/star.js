(() => {
  const modal = document.getElementById('starModal');
  if (!modal) return;

  const go = document.getElementById('starGo');
  const KEY_OFF = 'runshot.star.v2.off';
  const KEY_CLICKED = 'runshot.star.v2.clicked';
  const read = (store, k) => { try { return store.getItem(k); } catch (e) { return null; } };
  const write = (store, k, v) => { try { store.setItem(k, v); } catch (e) {} };

  const close = () => {
    modal.hidden = true;
  };

  modal.querySelectorAll('[data-star-close]').forEach(el => el.addEventListener('click', close));
  document.getElementById('starX').addEventListener('click', close);
  document.getElementById('starNever').addEventListener('click', () => {
    write(localStorage, KEY_OFF, '1');
    close();
  });
  if (go) go.addEventListener('click', () => {
    write(localStorage, KEY_CLICKED, String(Date.now()));
    close();
  });
  document.addEventListener('keydown', e => {
    if (!modal.hidden && e.key === 'Escape') close();
  });

  const params = new URLSearchParams(location.search);
  if (params.has('selftest')) return;
  if (!params.has('star') && (
    read(localStorage, KEY_OFF) ||
    read(localStorage, KEY_CLICKED)
  )) return;

  setTimeout(() => {
    modal.hidden = false;
    if (go) go.focus({ preventScroll: true });
  }, 900);
})();
