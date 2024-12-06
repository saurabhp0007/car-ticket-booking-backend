const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
  // Create a transporter using Gmail
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      // Use App Password, not your regular Gmail password
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  // Define email options
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: options.email,
    subject: options.subject,
    text: options.message
  };

  // Send email
  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
