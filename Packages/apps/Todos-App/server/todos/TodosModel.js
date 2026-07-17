import { globalAccessPoint } from '../../../../server/Orion-core/index.js';

// Hard cap on rows returned per list call — the query must never be unbounded.
const LIST_LIMIT = 500;

const migrate = async () => {
    const pool = globalAccessPoint.db().getPool();

    await pool.query(`
        CREATE TABLE IF NOT EXISTS todos (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
            title TEXT NOT NULL CHECK (char_length(title) <= 1000),
            done BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);

    // Composite index matches the list query's WHERE + ORDER BY exactly;
    // replaces the old single-column todos_user_uid_idx.
    await pool.query('CREATE INDEX IF NOT EXISTS todos_user_created_idx ON todos(user_uid, created_at DESC, id DESC)');
    await pool.query('DROP INDEX IF EXISTS todos_user_uid_idx');
};

const listTodos = async (userUid) => {
    const pool = globalAccessPoint.db().getPool();
    const { rows } = await pool.query(
        `SELECT id, title, done, created_at, updated_at FROM todos
         WHERE user_uid = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
        [userUid, LIST_LIMIT]
    );
    return rows;
};

const createTodo = async (userUid, title) => {
    const pool = globalAccessPoint.db().getPool();
    const { rows } = await pool.query(
        'INSERT INTO todos (user_uid, title) VALUES ($1, $2) RETURNING id, title, done, created_at, updated_at',
        [userUid, title]
    );
    return rows[0];
};

const updateTodo = async (userUid, id, fields) => {
    const pool = globalAccessPoint.db().getPool();
    const sets = [];
    const values = [id, userUid];
    let idx = 3;

    if (typeof fields.title === 'string') {
        sets.push(`title = $${idx++}`);
        values.push(fields.title);
    }

    if (typeof fields.done === 'boolean') {
        sets.push(`done = $${idx++}`);
        values.push(fields.done);
    }

    if (sets.length === 0) {
        return null;
    }

    sets.push('updated_at = now()');

    const { rows } = await pool.query(
        `UPDATE todos SET ${sets.join(', ')} WHERE id = $1 AND user_uid = $2 RETURNING id, title, done, created_at, updated_at`,
        values
    );

    return rows[0] || null;
};

const deleteTodo = async (userUid, id) => {
    const pool = globalAccessPoint.db().getPool();
    const { rowCount } = await pool.query('DELETE FROM todos WHERE id = $1 AND user_uid = $2', [id, userUid]);
    return rowCount > 0;
};

export { migrate, listTodos, createTodo, updateTodo, deleteTodo };
