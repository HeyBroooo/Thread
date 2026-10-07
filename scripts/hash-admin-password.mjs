import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

if (!stdin.isTTY) {
  process.stderr.write('Run this script in an interactive terminal so the password is not piped or logged.\n');
  process.exit(1);
}

const readline = createInterface({ input: stdin, output: stdout });
try {
  const password = await readline.question('Admin password (input is visible in this terminal): ');
  if (password.length < 12) {
    throw new Error('Use a password with at least 12 characters.');
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  process.stdout.write(`ADMIN_PASSWORD_HASH=scrypt$${salt.toString('hex')}$${hash.toString('hex')}\n`);
} finally {
  readline.close();
}
