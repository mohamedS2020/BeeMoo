const cron = require('node-cron');
const AnalyticsDatabase = require('./database');
const EmailReporter = require('./emailReporter_enhanced');

class AnalyticsManager {
  constructor() {
    this.database = new AnalyticsDatabase();
    this.emailReporter = null; // Will be initialized after database setup
    this.isSchedulerStarted = false;
  }

  /**
   * Start the analytics system
   */
  async start() {
    console.log('🚀 Starting BeeMoo Analytics System...');
    
    // Wait a moment for database to initialize
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Initialize email reporter with database connection
    this.emailReporter = new EmailReporter(this.database.db);
    
    // Start scheduled reports
    this.startScheduler();
    
    console.log('✅ Analytics system running');
  }

  /**
   * Start cron job scheduler for automatic reports
   */
  startScheduler() {
    if (this.isSchedulerStarted) {
      console.warn('⚠️ Scheduler already started');
      return;
    }

    // Weekly report - Every Monday at 9:00 AM
    cron.schedule('0 9 * * 1', async () => {
      console.log('📅 Generating weekly report...');
      await this.generateWeeklyReport();
    }, {
      timezone: 'UTC'
    });

    // Monthly report - First day of month at 9:00 AM
    cron.schedule('0 9 1 * *', async () => {
      console.log('📅 Generating monthly report...');
      await this.generateMonthlyReport();
    }, {
      timezone: 'UTC'
    });

    // Test report - For development/testing (optional)
    // Uncomment this line to send test reports every minute
    // cron.schedule('* * * * *', () => this.generateTestReport());

    this.isSchedulerStarted = true;
    console.log('⏰ Report scheduler started');
    console.log('   📅 Weekly reports: Mondays at 9:00 AM UTC');
    console.log('   📅 Monthly reports: 1st of month at 9:00 AM UTC');
  }

  /**
   * Record analytics events (called by other parts of the system)
   */
  recordEvent(eventType, roomCode = null, username = null, metadata = {}) {
    this.database.recordEvent(eventType, roomCode, username, metadata);
  }

  /**
   * Generate and send weekly report
   */
  async generateWeeklyReport() {
    try {
      console.log('📊 Generating enhanced weekly report...');
      
      await this.emailReporter.sendWeeklyReport();
      
      console.log('✅ Weekly report completed');
    } catch (error) {
      console.error('❌ Error generating weekly report:', error);
    }
  }

  /**
   * Generate and send monthly report
   */
  async generateMonthlyReport() {
    try {
      console.log('📊 Generating enhanced monthly report...');
      
      await this.emailReporter.sendMonthlyReport();
      
      console.log('✅ Monthly report completed');
    } catch (error) {
      console.error('❌ Error generating monthly report:', error);
    }
  }

  /**
   * Generate test report (for development)
   */
  /**
   * Generate test report (for development)
   */
  async generateTestReport() {
    try {
      console.log('🧪 Generating enhanced test report...');
      
      await this.emailReporter.sendTestReport();
      
      console.log('✅ Test report sent');
    } catch (error) {
      console.error('❌ Error generating test report:', error);
    }
  }

  /**
   * Manual report generation (for testing)
   */
  async generateManualReport(reportType = 'weekly') {
    console.log(`📊 Manually generating ${reportType} report...`);
    
    if (reportType === 'weekly') {
      await this.generateWeeklyReport();
    } else if (reportType === 'monthly') {
      await this.generateMonthlyReport();
    } else if (reportType === 'test') {
      await this.generateTestReport();
    }
  }

  /**
   * Get current analytics stats (for API endpoints)
   */
  async getCurrentStats() {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 30); // Last 30 days

    return await this.database.getDetailedAnalytics(startDate, endDate);
  }

  /**
   * Shutdown analytics system
   */
  shutdown() {
    console.log('🛑 Shutting down analytics system...');
    
    if (this.database) {
      this.database.close();
    }
    
    console.log('✅ Analytics system shutdown complete');
  }
}

module.exports = AnalyticsManager;
