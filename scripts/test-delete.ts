import * as db from '@cbi/db';
import { getGraphStore } from '@cbi/graph';

async function test() {
  const repoId = '25f9c15c-0242-4dee-9e9e-b7aa1f4fcb86';
  const orgId = '6df23446-5544-4330-b5b2-789a808e5baa';
  
  console.log('Testing graphStore clearRepository...');
  try {
    await getGraphStore().clearRepository(repoId);
    console.log('clearRepository OK');
  } catch (err) {
    console.error('clearRepository FAILED:', err);
  }

  console.log('Testing writeAuditLog...');
  try {
    await db.writeAuditLog({
      organizationId: orgId,
      repositoryId: repoId,
      action: 'repository.deleted',
      metadata: {},
      requestId: 'test-req',
    });
    console.log('writeAuditLog OK');
  } catch (err) {
    console.error('writeAuditLog FAILED:', err);
  }

  console.log('Testing deleteRepository in transaction (rollback)...');
  const pool = db.getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      'DELETE FROM repositories WHERE id = $1 AND organization_id = $2 RETURNING id',
      [repoId, orgId]
    );
    console.log('deleteRepository res:', res.rows);
    await client.query('ROLLBACK');
    console.log('deleteRepository test succeeded and rolled back!');
  } catch (err) {
    console.error('deleteRepository FAILED:', err);
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
  }
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
