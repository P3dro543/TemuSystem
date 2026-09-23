(() => {
  document.querySelectorAll('form[data-confirm]').forEach((formulario) => {
    formulario.addEventListener('submit', (event) => {
      if (!window.confirm(formulario.dataset.confirm)) event.preventDefault();
    });
  });
})();
