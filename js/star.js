(() => {
  const modal = document.getElementById('starModal');
  if (!modal) return;

  const go = document.getElementById('starGo');
  const read = (store, k) => { try { return store.getItem(k); } catch (e) { return null; } };
  const write = (store, k, v) => { try { store.setItem(k, v); } catch (e) {} };

  const close = () => {
    modal.hidden = true;
    write(sessionStorage, 'runshot.star.seen', '1');
  };

  modal.querySelectorAll('[data-star-close]').forEach(el => el.addEventListener('click', close));
  document.getElementById('starX').addEventListener('click', close);
  document.getElementById('starNever').addEventListener('click', () => {
    write(localStorage, 'runshot.star.off', '1');
    close();
  });
  if (go) go.addEventListener('click', () => {
    write(localStorage, 'runshot.star.clicked', String(Date.now()));
    close();
  });
  document.addEventListener('keydown', e => {
    if (!modal.hidden && e.key === 'Escape') close();
  });

  const params = new URLSearchParams(location.search);
  if (params.has('selftest')) return;
  if (!params.has('star') && (
    read(localStorage, 'runshot.star.off') ||
    read(localStorage, 'runshot.star.clicked') ||
    read(sessionStorage, 'runshot.star.seen')
  )) return;

  setTimeout(() => {
    modal.hidden = false;
    if (go) go.focus({ preventScroll: true });
  }, 900);
})();
