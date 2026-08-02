'use strict';

const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');

const PUBLIC_FIELDS =
  'id, username, email, full_name, affiliation, is_admin, is_active, created_at, updated_at';

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    affiliation: row.affiliation,
    isAdmin: !!row.is_admin,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findById(id) {
  const db = getDb();
  return toPublic(
    db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`).get(id)
  );
}

function findRawById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function verifyPassword(userId, password) {
  const row = findRawById(userId);
  if (!row || !row.is_active) return false;
  return bcrypt.compareSync(password, row.password_hash);
}

function updatePassword(userId, newPassword) {
  const db = getDb();
  const hash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, userId);
  return findById(userId);
}

function findByUsername(username) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function findByEmail(email) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

/**
 * Authenticate by username and password.
 * @returns {object|null} public user or null
 */
function authenticate(username, password) {
  const user = findByUsername(username);
  if (!user || !user.is_active) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return toPublic(user);
}

/**
 * Create an active user account (used after application approval).
 */
function createUser({ username, email, passwordHash, fullName, affiliation, isAdmin = false }) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, full_name, affiliation, is_admin, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    )
    .run(username, email, passwordHash, fullName, affiliation, isAdmin ? 1 : 0);
  return findById(result.lastInsertRowid);
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function listUsers() {
  const db = getDb();
  return db
    .prepare(`SELECT ${PUBLIC_FIELDS} FROM users ORDER BY id`)
    .all()
    .map(toPublic);
}

function setAdmin(userId, isAdmin) {
  const db = getDb();
  db.prepare('UPDATE users SET is_admin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(isAdmin ? 1 : 0, userId);
  return findById(userId);
}

module.exports = {
  toPublic,
  findById,
  findRawById,
  verifyPassword,
  updatePassword,
  setAdmin,
  findByUsername,
  findByEmail,
  authenticate,
  createUser,
  hashPassword,
  listUsers,
};
