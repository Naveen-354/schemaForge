// Account maintenance from the command line (there is no email-based recovery in a local app).
//   npm run user -- list
//   npm run user -- reset-password <email> <new-password>
import { openDb } from '../store/db.js';
import { destroyUserSessions, hashPassword, normalizeEmail, users, validatePassword } from '../auth.js';

openDb();
const [cmd, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  if (cmd === 'list') {
    const list = users.list();
    if (list.length === 0) console.log('No accounts.');
    for (const u of list) console.log(`${u.email}\t${u.provider}\tcreated ${u.createdAt}`);
    return;
  }
  if (cmd === 'reset-password') {
    const [emailArg, password] = args;
    const email = normalizeEmail(emailArg);
    const user = users.findByEmail(email);
    if (!user) throw new Error(`No account for ${email}`);
    if (user.provider !== 'local') throw new Error(`${email} signs in with ${user.provider}; it has no password.`);
    users.setPassword(user.id, await hashPassword(validatePassword(password)));
    destroyUserSessions(user.id);
    console.log(`Password reset for ${email}. All of its sessions were signed out.`);
    return;
  }
  console.log('Usage:\n  npm run user -- list\n  npm run user -- reset-password <email> <new-password>');
  process.exitCode = 1;
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
