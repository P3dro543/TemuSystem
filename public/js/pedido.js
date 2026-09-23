(() => {
  const contenedor = document.getElementById('articulos');
  const agregar = document.getElementById('agregar-articulo');
  const nuevaFila = () => {
    const fila = document.createElement('div');
    fila.className = 'item-row';
    fila.innerHTML = '<label class="field-link">Enlace de Temu<input type="url" name="link" placeholder="https://www.temu.com/..." maxlength="2048" required></label><label>Cantidad<input type="number" name="cantidad" min="1" max="9999" value="1" required></label><label>Nota <span class="muted">(opcional)</span><input name="nota" maxlength="500" placeholder="Talla, color, modelo..."></label><button class="button button-quiet quitar-fila" type="button" aria-label="Quitar artículo">Quitar</button>';
    return fila;
  };
  agregar.addEventListener('click', () => { if (contenedor.children.length < 30) contenedor.append(nuevaFila()); agregar.disabled = contenedor.children.length >= 30; });
  contenedor.addEventListener('click', (event) => {
    if (!event.target.closest('.quitar-fila')) return;
    if (contenedor.children.length <= 1) { window.alert('El pedido debe tener al menos un artículo.'); return; }
    event.target.closest('.item-row').remove(); agregar.disabled = false;
  });
})();
