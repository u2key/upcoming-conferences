'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!config.mail.host) {
    // Development fallback: log to console instead of sending
    transporter = {
      sendMail: async (options) => {
        console.log('[mail:dev] -----');
        console.log(`[mail:dev] To: ${options.to}`);
        console.log(`[mail:dev] Subject: ${options.subject}`);
        console.log(`[mail:dev] ${options.text}`);
        console.log('[mail:dev] -----');
        return { messageId: `dev-${Date.now()}` };
      },
    };
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user
      ? { user: config.mail.user, pass: config.mail.pass }
      : undefined,
  });
  return transporter;
}

/**
 * Notify applicant that their account was approved.
 */
async function sendApprovalNotification({ email, fullName, username }) {
  const loginUrl = `${config.appBaseUrl}/login.html`;
  const text = [
    `${fullName} 様`,
    '',
    'アカウント作成申請が承認されました。',
    '',
    `ユーザ名: ${username}`,
    `ログインURL: ${loginUrl}`,
    '',
    '申請時に設定したパスワードでログインできます。',
    '',
    '---',
    '学会締め切り管理システム',
  ].join('\n');

  const transport = getTransporter();
  await transport.sendMail({
    from: config.mail.from,
    to: email,
    subject: '[学会締め切り管理] アカウントが承認されました',
    text,
  });
}

async function sendPasswordResetNotification({ email, fullName, username, newPassword }) {
  const loginUrl = `${config.appBaseUrl}/login.html`;
  const text = [
    `${fullName} 様`,
    '',
    '管理者によりパスワードがリセットされました。',
    '',
    `ユーザ名: ${username}`,
    `新しいパスワード: ${newPassword}`,
    `ログインURL: ${loginUrl}`,
    '',
    'ログイン後、必要に応じてパスワードを変更してください。',
    '',
    '---',
    '学会締め切り管理システム',
  ].join('\n');

  const transport = getTransporter();
  await transport.sendMail({
    from: config.mail.from,
    to: email,
    subject: '[学会締め切り管理] パスワードがリセットされました',
    text,
  });
}

// Notify admins that a new account application has been submitted.
async function sendApplicationSubmittedNotification(application) {
  // Lazy require users to avoid startup cycles elsewhere
  const users = require('./users');
  const admins = users
    .listUsers()
    .filter((u) => u.isAdmin && u.isActive && u.email)
    .map((u) => u.email);

  const adminList = admins.join(', ');
  const adminUrl = `${config.appBaseUrl}/admin/users.html`;
  const textLines = [
    '新しいアカウント申請が提出されました。',
    '',
    `申請者: ${application.fullName || '(名前なし)'}`,
    `ユーザ名: ${application.username || '(なし)'}`,
    `メール: ${application.email || '(なし)'}`,
    `所属: ${application.affiliation || '(なし)'}`,
    '',
    `管理画面で確認: ${adminUrl}`,
    '',
    '---',
    '学会締め切り管理システム',
  ];

  const transport = getTransporter();
  // If there are no admin emails, still log via dev transporter
  await transport.sendMail({
    from: config.mail.from,
    to: adminList || config.mail.from,
    subject: '[学会締め切り管理] 新しいアカウント申請',
    text: textLines.join('\n'),
  });
}

module.exports = {
  getTransporter,
  sendApprovalNotification,
  sendPasswordResetNotification,
  sendApplicationSubmittedNotification,
};
