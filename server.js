require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- Database Setup (run once, then comment out or remove) ---
app.get('/admin/init', async (req, res) => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS contestants (
            id TEXT PRIMARY KEY,
            name TEXT,
            faculty TEXT,
            course TEXT,
            photo TEXT,
            category TEXT,
            votes INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS voters (
            voter_id TEXT PRIMARY KEY
        );
    `);
    res.send('Tables created');
});
// -------------------------------------------------------------

// Get all contestants grouped by faculty/category
app.get('/contestants', async (req, res) => {
    const result = await pool.query('SELECT * FROM contestants');
    const grouped = {};
    result.rows.forEach(c => {
        if (!grouped[c.faculty]) grouped[c.faculty] = { mr: [], ms: [] };
        grouped[c.faculty][c.category].push(c);
    });
    res.json(grouped);
});

// Check if voter has voted
app.get('/hasVoted', async (req, res) => {
    const { voterId } = req.query;
    const result = await pool.query('SELECT 1 FROM voters WHERE voter_id = $1', [voterId]);
    res.json({ hasVoted: result.rowCount > 0 });
});

// Vote endpoint
app.post('/vote', async (req, res) => {
    const { mrId, msId, voterId } = req.body;
    if (!mrId || !msId || !voterId) return res.status(400).json({ message: 'Missing data' });

    // Prevent double voting
    const already = await pool.query('SELECT 1 FROM voters WHERE voter_id = $1', [voterId]);
    if (already.rowCount > 0) return res.status(400).json({ message: 'You have already voted.' });

    // Update votes atomically
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('UPDATE contestants SET votes = votes + 1 WHERE id = $1 AND category = $2', [mrId, 'mr']);
        await client.query('UPDATE contestants SET votes = votes + 1 WHERE id = $1 AND category = $2', [msId, 'ms']);
        await client.query('INSERT INTO voters (voter_id) VALUES ($1)', [voterId]);
        await client.query('COMMIT');
        res.json({ message: 'Vote recorded.' });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ message: 'Vote failed.' });
    } finally {
        client.release();
    }
});

// (Optional) Admin: Add contestants (POST JSON array)
app.post('/admin/addContestants', async (req, res) => {
    const contestants = req.body; // [{id, name, faculty, course, photo, category}]
    for (const c of contestants) {
        await pool.query(
            'INSERT INTO contestants (id, name, faculty, course, photo, category, votes) VALUES ($1,$2,$3,$4,$5,$6,0) ON CONFLICT (id) DO NOTHING',
            [c.id, c.name, c.faculty, c.course, c.photo, c.category]
        );
    }
    res.send('Contestants added');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));