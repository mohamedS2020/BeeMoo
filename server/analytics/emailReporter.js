const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const path = require('path');
const fs = require('fs');

class EmailReporter {
  constructor() {
    this.transporter = null;
    this.setupTransporter();
  }

  /**
   * Setup email transporter
   * You'll need to set these environment variables:
   * - EMAIL_USER: Your Gmail address
   * - EMAIL_PASS: Your Gmail app password
   * - REPORT_EMAIL: Email address to send reports to
   */
  setupTransporter() {
    // Check if email credentials are provided
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('⚠️ Email credentials not configured. Set EMAIL_USER and EMAIL_PASS environment variables.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // Verify connection
    this.transporter.verify((error, success) => {
      if (error) {
        console.error('❌ Email transporter setup failed:', error);
      } else {
        console.log('✅ Email transporter ready');
      }
    });
  }

  /**
   * Generate weekly report email
   * @param {object} analyticsData - Analytics data from database
   * @param {Date} startDate - Report period start
   * @param {Date} endDate - Report period end
   */
  async sendWeeklyReport(analyticsData, startDate, endDate) {
    if (!this.transporter) {
      console.warn('⚠️ Email not configured, logging report instead:');
      console.log('📊 Weekly BeeMoo Report:', analyticsData);
      return;
    }

    const reportData = {
      reportType: 'Weekly',
      startDate: startDate.toLocaleDateString(),
      endDate: endDate.toLocaleDateString(),
      ...analyticsData,
      generatedAt: new Date().toLocaleString()
    };

    const emailHtml = this.generateReportHTML(reportData);
    const emailText = this.generateReportText(reportData);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.REPORT_EMAIL || process.env.EMAIL_USER,
      subject: `📊 BeeMoo Weekly Report - ${reportData.startDate} to ${reportData.endDate}`,
      text: emailText,
      html: emailHtml
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('✅ Weekly report sent:', info.messageId);
    } catch (error) {
      console.error('❌ Failed to send weekly report:', error);
    }
  }

  /**
   * Generate monthly report email
   * @param {object} analyticsData - Analytics data from database
   * @param {Date} startDate - Report period start
   * @param {Date} endDate - Report period end
   */
  async sendMonthlyReport(analyticsData, startDate, endDate) {
    if (!this.transporter) {
      console.warn('⚠️ Email not configured, logging report instead:');
      console.log('📊 Monthly BeeMoo Report:', analyticsData);
      return;
    }

    const reportData = {
      reportType: 'Monthly',
      startDate: startDate.toLocaleDateString(),
      endDate: endDate.toLocaleDateString(),
      ...analyticsData,
      generatedAt: new Date().toLocaleString()
    };

    const emailHtml = this.generateReportHTML(reportData);
    const emailText = this.generateReportText(reportData);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.REPORT_EMAIL || process.env.EMAIL_USER,
      subject: `📊 BeeMoo Monthly Report - ${reportData.startDate} to ${reportData.endDate}`,
      text: emailText,
      html: emailHtml
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('✅ Monthly report sent:', info.messageId);
    } catch (error) {
      console.error('❌ Failed to send monthly report:', error);
    }
  }

  /**
   * Generate HTML email template
   * @param {object} data - Report data
   * @returns {string} HTML content
   */
  generateReportHTML(data) {
    const template = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .metric { background: white; margin: 15px 0; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea; }
            .metric-title { font-weight: bold; color: #667eea; margin-bottom: 10px; }
            .metric-value { font-size: 24px; font-weight: bold; color: #333; }
            .users-list { background: white; padding: 15px; border-radius: 8px; margin: 10px 0; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
            .emoji { font-size: 1.2em; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1><span class="emoji">🎬</span> BeeMoo {{reportType}} Report</h1>
                <p>{{startDate}} to {{endDate}}</p>
            </div>
            
            <div class="content">
                <div class="metric">
                    <div class="metric-title"><span class="emoji">🏠</span> Rooms Created</div>
                    <div class="metric-value">{{roomsCreated}}</div>
                </div>
                
                <div class="metric">
                    <div class="metric-title"><span class="emoji">👥</span> Users Joined</div>
                    <div class="metric-value">{{usersJoined}}</div>
                </div>
                
                <div class="metric">
                    <div class="metric-title"><span class="emoji">🎭</span> Movie Parties Started</div>
                    <div class="metric-value">{{moviePartiesStarted}}</div>
                </div>
                
                {{#if topUsers.length}}
                <div class="metric">
                    <div class="metric-title"><span class="emoji">⭐</span> Most Active Users</div>
                    <div class="users-list">
                        {{#each topUsers}}
                        <div>{{@index}}. <strong>{{username}}</strong> ({{activity_count}} activities)</div>
                        {{/each}}
                    </div>
                </div>
                {{/if}}
                
                {{#if peakHours.length}}
                <div class="metric">
                    <div class="metric-title"><span class="emoji">📈</span> Peak Usage Hours</div>
                    <div class="users-list">
                        {{#each peakHours}}
                        <div>{{hour}}:00 - {{events}} events</div>
                        {{/each}}
                    </div>
                </div>
                {{/if}}
            </div>
            
            <div class="footer">
                <p>Generated at {{generatedAt}}</p>
                <p><span class="emoji">🚀</span> BeeMoo Analytics System</p>
            </div>
        </div>
    </body>
    </html>`;

    const compiledTemplate = handlebars.compile(template);
    return compiledTemplate(data);
  }

  /**
   * Generate plain text email content
   * @param {object} data - Report data
   * @returns {string} Text content
   */
  generateReportText(data) {
    let text = `🎬 BeeMoo ${data.reportType} Report\n`;
    text += `Period: ${data.startDate} to ${data.endDate}\n\n`;
    text += `📊 METRICS:\n`;
    text += `🏠 Rooms Created: ${data.roomsCreated}\n`;
    text += `👥 Users Joined: ${data.usersJoined}\n`;
    text += `🎭 Movie Parties Started: ${data.moviePartiesStarted}\n\n`;
    
    if (data.topUsers && data.topUsers.length > 0) {
      text += `⭐ MOST ACTIVE USERS:\n`;
      data.topUsers.forEach((user, index) => {
        text += `${index + 1}. ${user.username} (${user.activity_count} activities)\n`;
      });
      text += `\n`;
    }
    
    if (data.peakHours && data.peakHours.length > 0) {
      text += `📈 PEAK USAGE HOURS:\n`;
      data.peakHours.forEach(hour => {
        text += `${hour.hour}:00 - ${hour.events} events\n`;
      });
      text += `\n`;
    }
    
    text += `Generated at: ${data.generatedAt}\n`;
    text += `🚀 BeeMoo Analytics System`;
    
    return text;
  }
}

module.exports = EmailReporter;
