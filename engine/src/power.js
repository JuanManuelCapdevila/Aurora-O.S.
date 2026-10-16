'use strict';

const { spawnSync } = require('node:child_process');
const { loadProfile } = require('./config');

// Aplica un modo de energía usando ryzenadj (requiere la regla de sudoers que
// instala postinstall.sh). Valores en mW.
function setPowerMode(system, mode) {
  const device = loadProfile('device', system.device);
  const modes = device.power?.modes || {};
  const limits = modes[mode];
  if (!limits) throw new Error(`Modo desconocido "${mode}". Disponibles: ${Object.keys(modes).join(', ')}`);

  const args = [
    '-n', 'ryzenadj',
    `--stapm-limit=${limits.stapmLimit}`,
    `--fast-limit=${limits.fastLimit}`,
    `--slow-limit=${limits.slowLimit}`,
  ];
  const res = spawnSync('sudo', args, { encoding: 'utf8' });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`ryzenadj falló: ${res.stderr || res.stdout}`);
  return limits;
}

module.exports = { setPowerMode };
