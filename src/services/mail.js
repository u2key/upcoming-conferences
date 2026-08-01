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

module.exports = {
  getTransporter,
  sendApprovalNotification,
};
