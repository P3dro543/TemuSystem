require('dotenv').config();
const bcrypt = require('bcrypt');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
const pool = require('./pool');

async function main() {
  const rl = readline.createInterface({ input, output });
  try {
    const nombre = (await rl.question('Nombre del administrador: ')).trim();
    const correo = (await rl.question('Correo: ')).trim().toLowerCase();
    const contrasena = await rl.question('Contraseña (mínimo 12 caracteres): ');
    if (nombre.length < 2 || nombre.length > 120) throw new Error('El nombre debe tener entre 2 y 120 caracteres.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('El correo no tiene un formato válido.');
    if (contrasena.length < 12 || contrasena.length > 72) throw new Error('La contraseña debe tener entre 12 y 72 caracteres.');
    const hash = await bcrypt.hash(contrasena, 12);
    await pool.query('INSERT INTO usuarios (nombre, correo, contrasena_hash, rol) VALUES ($1, $2, $3, $4)', [nombre, correo, hash, 'admin']);
    console.log('Administrador creado correctamente.');
  } catch (err) {
    console.error(`No se pudo crear el administrador: ${err.code === '23505' ? 'ya existe un usuario con ese correo.' : err.message}`);
    process.exitCode = 1;
  } finally { rl.close(); await pool.end(); }
}
main();
