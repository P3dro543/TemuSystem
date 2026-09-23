(() => {
  const formulario = document.getElementById('form-cotizar');
  const salida = document.getElementById('total-vivo');
  if (!formulario || !salida) return;
  const precio = [...formulario.querySelectorAll('[name="precio_unitario"]')];
  const cargos = [...formulario.querySelectorAll('[data-cargo]')];
  const simbolo = salida.textContent.match(/^[^\d\s-]+/)?.[0] || '$';
  const actualizar = () => {
    let centavos = 0;
    for (const input of precio) {
      const cantidad = Number(input.dataset.cantidad);
      const valor = Math.round(Number(input.value || 0) * 100);
      if (!Number.isFinite(cantidad) || !Number.isFinite(valor)) continue;
      centavos += cantidad * valor;
    }
    for (const input of cargos) centavos += Math.round(Number(input.value || 0) * 100);
    salida.textContent = `${simbolo}${(centavos / 100).toFixed(2)}`;
  };
  formulario.addEventListener('input', actualizar);
  actualizar();
})();
