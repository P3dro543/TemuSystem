(() => {
  const formulario = document.getElementById('form-cotizar');
  const salida = document.getElementById('total-vivo');
  if (!formulario || !salida) return;
  const precio = [...formulario.querySelectorAll('[name="precio_unitario"]')];
  const cargos = [...formulario.querySelectorAll('[data-cargo]')];
  const simbolo = salida.dataset.currency || '$';
  const actualizar = () => {
    let centavos = 0;
    for (const input of precio) {
      const cantidad = Number(input.dataset.cantidad);
      const valor = Math.round(Number(input.value || 0) * 100);
      if (!Number.isFinite(cantidad) || !Number.isFinite(valor)) continue;
      centavos += cantidad * valor;
    }
    for (const input of cargos) centavos += Math.round(Number(input.value || 0) * 100);
    const monto = new Intl.NumberFormat('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centavos / 100);
    salida.textContent = `${simbolo} ${monto}`;
  };
  formulario.addEventListener('input', actualizar);
  actualizar();
})();
