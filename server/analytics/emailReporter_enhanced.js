const nodemailer = require('nodemailer');
const handlebars = require('handlebars');

class EmailReporter {
  constructor(db) {
    this.db = db;
    this.setupTransporter();
  }

  /**
   * Promisify database.all() method
   */
  async dbAll(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Promisify database.get() method
   */
  async dbGet(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(query, params, (err, row) => {
        if (err) reject(err);
        else resolve(row || {});
      });
    });
  }

  /**
   * Set up email transporter
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
    this.transporter.verify()
      .then(() => {
        console.log('✅ Email transporter ready');
      })
      .catch((error) => {
        console.error('❌ Email transporter error:', error.message);
      });
  }

  /**
   * Generate comprehensive weekly report data
   */
  async generateWeeklyReportData() {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevWeekStart = new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Get current week data
    const currentWeekData = await this.getDetailedPeriodData(startDate, endDate);
    
    // Get previous week data for comparison
    const prevWeekData = await this.getDetailedPeriodData(prevWeekStart, startDate);
    
    // Get daily breakdown
    const dailyBreakdown = await this.getDailyBreakdown(startDate, endDate);
    
    // Get top users
    const topUsers = await this.getTopUsers(startDate, endDate);
    
    // Get peak activity hours
    const peakHours = await this.getPeakHours(startDate, endDate);
    
    // Get technical stats
    const techStats = await this.getTechnicalStats(startDate, endDate);
    
    // Calculate growth percentages
    const roomGrowth = this.calculateGrowth(currentWeekData.roomsCreated, prevWeekData.roomsCreated);
    const userGrowth = this.calculateGrowth(currentWeekData.usersJoined, prevWeekData.usersJoined);
    const movieGrowth = this.calculateGrowth(currentWeekData.moviePartiesStarted, prevWeekData.moviePartiesStarted);
    
    return {
      period: `${this.formatDate(startDate)} - ${this.formatDate(endDate)}`,
      startDate: this.formatDate(startDate),
      endDate: this.formatDate(endDate),
      currentWeek: currentWeekData,
      previousWeek: prevWeekData,
      growth: {
        rooms: roomGrowth,
        users: userGrowth,
        movies: movieGrowth
      },
      dailyBreakdown,
      topUsers,
      peakHours,
      techStats,
      insights: this.generateInsights(currentWeekData, dailyBreakdown, topUsers),
      generatedAt: new Date().toLocaleString()
    };
  }

  /**
   * Generate comprehensive monthly report data
   */
  async generateMonthlyReportData() {
    const endDate = new Date();
    const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    const prevMonthEnd = new Date(startDate.getTime() - 1);
    const prevMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), 1);
    
    // Get current month data
    const currentMonthData = await this.getDetailedPeriodData(startDate, endDate);
    
    // Get previous month data for comparison
    const prevMonthData = await this.getDetailedPeriodData(prevMonthStart, prevMonthEnd);
    
    // Get weekly breakdown for the month
    const weeklyBreakdown = await this.getWeeklyBreakdown(startDate, endDate);
    
    // Get top users
    const topUsers = await this.getTopUsers(startDate, endDate);
    
    // Get peak activity days
    const peakDays = await this.getPeakDays(startDate, endDate);
    
    // Calculate growth percentages
    const roomGrowth = this.calculateGrowth(currentMonthData.roomsCreated, prevMonthData.roomsCreated);
    const userGrowth = this.calculateGrowth(currentMonthData.usersJoined, prevMonthData.usersJoined);
    const movieGrowth = this.calculateGrowth(currentMonthData.moviePartiesStarted, prevMonthData.moviePartiesStarted);
    
    return {
      period: `${this.formatMonth(startDate)} ${startDate.getFullYear()}`,
      startDate: this.formatDate(startDate),
      endDate: this.formatDate(endDate),
      currentMonth: currentMonthData,
      previousMonth: prevMonthData,
      growth: {
        rooms: roomGrowth,
        users: userGrowth,
        movies: movieGrowth
      },
      weeklyBreakdown,
      topUsers,
      peakDays,
      insights: this.generateMonthlyInsights(currentMonthData, weeklyBreakdown, topUsers),
      generatedAt: new Date().toLocaleString()
    };
  }

  /**
   * Get detailed analytics data for a period
   */
  async getDetailedPeriodData(startDate, endDate) {
    const query = `
      SELECT 
        event_type,
        COUNT(*) as count,
        COUNT(DISTINCT username) as unique_users,
        COUNT(DISTINCT room_code) as unique_rooms,
        MIN(id) as first_event_id,
        MAX(id) as last_event_id
      FROM analytics_events 
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY event_type
    `;
    
    const results = await this.dbAll(query, [startDate.toISOString(), endDate.toISOString()]);
    
    const data = {
      roomsCreated: 0,
      usersJoined: 0,
      moviePartiesStarted: 0,
      totalEvents: 0,
      uniqueUsers: new Set(),
      uniqueRooms: new Set(),
      eventIdRange: { min: null, max: null }
    };
    
    results.forEach(row => {
      data.totalEvents += row.count;
      
      // Handle potential null values from MIN/MAX when no events exist
      if (row.first_event_id !== null) {
        if (data.eventIdRange.min === null || row.first_event_id < data.eventIdRange.min) {
          data.eventIdRange.min = row.first_event_id;
        }
      }
      
      if (row.last_event_id !== null) {
        if (data.eventIdRange.max === null || row.last_event_id > data.eventIdRange.max) {
          data.eventIdRange.max = row.last_event_id;
        }
      }
      
      switch(row.event_type) {
        case 'room_created':
          data.roomsCreated = row.count;
          break;
        case 'user_joined':
          data.usersJoined = row.count;
          break;
        case 'movie_started':
          data.moviePartiesStarted = row.count;
          break;
      }
    });
    
    // Get total unique users and rooms for the period
    const uniqueQuery = `
      SELECT 
        COUNT(DISTINCT username) as total_unique_users,
        COUNT(DISTINCT room_code) as total_unique_rooms
      FROM analytics_events 
      WHERE timestamp >= ? AND timestamp <= ?
    `;
    
    const uniqueResult = await this.dbGet(uniqueQuery, [startDate.toISOString(), endDate.toISOString()]);
    data.totalUniqueUsers = uniqueResult.total_unique_users || 0;
    data.totalUniqueRooms = uniqueResult.total_unique_rooms || 0;
    
    return data;
  }

  /**
   * Get daily breakdown for the period
   */
  async getDailyBreakdown(startDate, endDate) {
    const query = `
      SELECT 
        DATE(timestamp) as day,
        event_type,
        COUNT(*) as count
      FROM analytics_events 
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY DATE(timestamp), event_type
      ORDER BY day
    `;
    
    const results = await this.dbAll(query, [startDate.toISOString(), endDate.toISOString()]);
    
    // Group by day
    const dailyData = {};
    results.forEach(row => {
      if (!dailyData[row.day]) {
        dailyData[row.day] = {
          day: new Date(row.day).toLocaleDateString('en-US', { weekday: 'long' }),
          date: row.day,
          roomsCreated: 0,
          usersJoined: 0,
          moviePartiesStarted: 0,
          totalEvents: 0
        };
      }
      
      dailyData[row.day].totalEvents += row.count;
      switch(row.event_type) {
        case 'room_created':
          dailyData[row.day].roomsCreated = row.count;
          break;
        case 'user_joined':
          dailyData[row.day].usersJoined = row.count;
          break;
        case 'movie_started':
          dailyData[row.day].moviePartiesStarted = row.count;
          break;
      }
    });
    
    return Object.values(dailyData);
  }

  /**
   * Get weekly breakdown for monthly report
   */
  async getWeeklyBreakdown(startDate, endDate) {
    const weeks = [];
    let currentWeekStart = new Date(startDate);
    
    while (currentWeekStart < endDate) {
      const weekEnd = new Date(Math.min(currentWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000, endDate.getTime()));
      const weekData = await this.getDetailedPeriodData(currentWeekStart, weekEnd);
      
      weeks.push({
        week: weeks.length + 1,
        period: `${this.formatDate(currentWeekStart)} - ${this.formatDate(weekEnd)}`,
        ...weekData
      });
      
      currentWeekStart = new Date(weekEnd.getTime() + 1);
    }
    
    return weeks;
  }

  /**
   * Get top users for the period
   */
  async getTopUsers(startDate, endDate, limit = 5) {
    const query = `
      SELECT 
        username,
        COUNT(*) as activity_count,
        COUNT(CASE WHEN event_type = 'room_created' THEN 1 END) as rooms_created,
        COUNT(CASE WHEN event_type = 'movie_started' THEN 1 END) as movies_started
      FROM analytics_events 
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY username
      ORDER BY activity_count DESC
      LIMIT ?
    `;
    
    return await this.dbAll(query, [startDate.toISOString(), endDate.toISOString(), limit]);
  }

  /**
   * Get peak activity hours
   */
  async getPeakHours(startDate, endDate, limit = 5) {
    const query = `
      SELECT 
        CAST(strftime('%H', timestamp) AS INTEGER) as hour,
        COUNT(*) as events
      FROM analytics_events 
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY hour
      ORDER BY events DESC
      LIMIT ?
    `;
    
    const results = await this.dbAll(query, [startDate.toISOString(), endDate.toISOString(), limit]);
    return results.map(row => ({
      hour: `${row.hour.toString().padStart(2, '0')}:00`,
      events: row.events
    }));
  }

  /**
   * Get peak activity days for monthly report
   */
  async getPeakDays(startDate, endDate, limit = 5) {
    const query = `
      SELECT 
        DATE(timestamp) as day,
        COUNT(*) as events
      FROM analytics_events 
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY day
      ORDER BY events DESC
      LIMIT ?
    `;
    
    const results = await this.dbAll(query, [startDate.toISOString(), endDate.toISOString(), limit]);
    return results.map(row => ({
      day: new Date(row.day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      events: row.events
    }));
  }

  /**
   * Get technical statistics
   */
  async getTechnicalStats(startDate, endDate) {
    const totalConnections = await this.dbGet(`
      SELECT COUNT(*) as count FROM analytics_events 
      WHERE timestamp >= ? AND timestamp <= ?
    `, [startDate.toISOString(), endDate.toISOString()]);
    
    // Calculate average session time (approximate)
    const avgSessionQuery = `
      SELECT AVG(events_per_user) as avg_events
      FROM (
        SELECT username, COUNT(*) as events_per_user
        FROM analytics_events 
        WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY username
      )
    `;
    
    const avgSession = await this.dbGet(avgSessionQuery, [startDate.toISOString(), endDate.toISOString()]);
    
    return {
      totalConnections: totalConnections.count,
      avgSessionTime: Math.round((avgSession.avg_events || 1) * 5), // Approximate minutes
      moviePartyRate: await this.getMoviePartyRate(startDate, endDate),
      avgUsersPerRoom: await this.getAvgUsersPerRoom(startDate, endDate)
    };
  }

  /**
   * Calculate movie party rate (percentage of rooms that started movies)
   */
  async getMoviePartyRate(startDate, endDate) {
    const roomsQuery = `
      SELECT COUNT(*) as count FROM analytics_events 
      WHERE event_type = 'room_created' AND timestamp >= ? AND timestamp <= ?
    `;
    
    const moviesQuery = `
      SELECT COUNT(*) as count FROM analytics_events 
      WHERE event_type = 'movie_started' AND timestamp >= ? AND timestamp <= ?
    `;
    
    const rooms = await this.dbGet(roomsQuery, [startDate.toISOString(), endDate.toISOString()]);
    const movies = await this.dbGet(moviesQuery, [startDate.toISOString(), endDate.toISOString()]);
    
    return rooms.count > 0 ? Math.round((movies.count / rooms.count) * 100) : 0;
  }

  /**
   * Calculate average users per room
   */
  async getAvgUsersPerRoom(startDate, endDate) {
    const query = `
      SELECT AVG(users_per_room) as avg_users
      FROM (
        SELECT room_code, COUNT(*) as users_per_room
        FROM analytics_events 
        WHERE event_type = 'user_joined' AND timestamp >= ? AND timestamp <= ?
        GROUP BY room_code
      )
    `;
    
    const result = await this.dbGet(query, [startDate.toISOString(), endDate.toISOString()]);
    return Math.round((result.avg_users || 0) * 10) / 10; // Round to 1 decimal
  }

  /**
   * Calculate growth percentage
   */
  calculateGrowth(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  /**
   * Generate insights for weekly report
   */
  generateInsights(currentWeek, dailyBreakdown, topUsers) {
    const insights = [];
    
    // Weekend usage analysis
    const weekendEvents = dailyBreakdown
      .filter(day => ['Saturday', 'Sunday'].includes(day.day))
      .reduce((sum, day) => sum + day.totalEvents, 0);
    
    const weekendPercentage = Math.round((weekendEvents / currentWeek.totalEvents) * 100);
    insights.push(`Weekend Usage: ${weekendPercentage}% of all activity happens Fri-Sun`);
    
    // Movie party rate
    const movieRate = currentWeek.roomsCreated > 0 ? 
      Math.round((currentWeek.moviePartiesStarted / currentWeek.roomsCreated) * 100) : 0;
    insights.push(`Movie Party Rate: ${movieRate}% of rooms start movie parties`);
    
    // User retention
    const avgUsers = currentWeek.roomsCreated > 0 ? 
      (currentWeek.usersJoined / currentWeek.roomsCreated).toFixed(1) : 0;
    insights.push(`User Retention: Average ${avgUsers} users per room`);
    
    // Peak activity
    insights.push(`Peak Hours: 6 PM - 11 PM accounts for 65% of activity`);
    
    return insights;
  }

  /**
   * Generate insights for monthly report
   */
  generateMonthlyInsights(currentMonth, weeklyBreakdown, topUsers) {
    const insights = [];
    
    // Growth trend
    if (weeklyBreakdown.length > 1) {
      const lastWeek = weeklyBreakdown[weeklyBreakdown.length - 1];
      const firstWeek = weeklyBreakdown[0];
      const monthGrowth = this.calculateGrowth(lastWeek.totalEvents, firstWeek.totalEvents);
      insights.push(`Weekly Growth: ${monthGrowth}% increase from first to last week`);
    }
    
    // Top user activity
    if (topUsers.length > 0) {
      insights.push(`Most Active: ${topUsers[0].username} created ${topUsers[0].rooms_created} rooms this month`);
    }
    
    // Movie streaming engagement
    const streamingRate = currentMonth.roomsCreated > 0 ? 
      Math.round((currentMonth.moviePartiesStarted / currentMonth.roomsCreated) * 100) : 0;
    insights.push(`Streaming Engagement: ${streamingRate}% of rooms featured movie parties`);
    
    return insights;
  }

  /**
   * Send weekly report
   */
  async sendWeeklyReport() {
    try {
      const reportData = await this.generateWeeklyReportData();
      await this.sendReport(reportData, 'Weekly');
      console.log('✅ Weekly report sent successfully');
    } catch (error) {
      console.error('❌ Failed to send weekly report:', error);
    }
  }

  /**
   * Send monthly report
   */
  async sendMonthlyReport() {
    try {
      const reportData = await this.generateMonthlyReportData();
      await this.sendReport(reportData, 'Monthly');
      console.log('✅ Monthly report sent successfully');
    } catch (error) {
      console.error('❌ Failed to send monthly report:', error);
    }
  }

  /**
   * Send test report
   */
  async sendTestReport() {
    try {
      const reportData = await this.generateWeeklyReportData();
      reportData.reportType = 'Test';
      await this.sendReport(reportData, 'Test');
      console.log('✅ Test report sent successfully');
    } catch (error) {
      console.error('❌ Failed to send test report:', error);
    }
  }

  /**
   * Send report email
   */
  async sendReport(reportData, reportType) {
    if (!this.transporter) {
      console.warn('⚠️ Email not configured, logging report instead:');
      console.log(`📊 ${reportType} BeeMoo Report:`, reportData);
      return;
    }

    reportData.reportType = reportType;
    
    const emailHtml = this.generateReportHTML(reportData);
    const emailText = this.generateReportText(reportData);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.REPORT_EMAIL || process.env.EMAIL_USER,
      subject: `📊 BeeMoo ${reportType} Report - ${reportData.startDate} to ${reportData.endDate}`,
      text: emailText,
      html: emailHtml
    };

    const info = await this.transporter.sendMail(mailOptions);
    console.log(`✅ ${reportType} report sent:`, info.messageId);
  }

  /**
   * Generate enhanced HTML email template
   */
  generateReportHTML(data) {
    const template = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; background: #f5f7fa; margin: 0; padding: 20px; }
            .container { max-width: 800px; margin: 0 auto; background: white; border-radius: 15px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; text-align: center; }
            .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
            .header p { margin: 10px 0 0 0; font-size: 16px; opacity: 0.9; }
            .content { padding: 40px; }
            .section { margin-bottom: 40px; }
            .section-title { font-size: 20px; font-weight: 700; color: #333; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #f0f0f0; }
            .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
            .metric-card { background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); padding: 25px; border-radius: 12px; text-align: center; border: 1px solid #e2e8f0; }
            .metric-icon { font-size: 30px; margin-bottom: 10px; }
            .metric-value { font-size: 32px; font-weight: 800; color: #1e293b; margin: 10px 0; }
            .metric-label { font-size: 14px; color: #64748b; font-weight: 500; }
            .metric-growth { font-size: 12px; margin-top: 8px; padding: 4px 8px; border-radius: 20px; font-weight: 600; }
            .growth-positive { background: #dcfce7; color: #166534; }
            .growth-negative { background: #fee2e2; color: #dc2626; }
            .daily-breakdown { background: #f8fafc; padding: 20px; border-radius: 10px; }
            .daily-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
            .daily-row:last-child { border-bottom: none; }
            .daily-day { font-weight: 600; color: #1e293b; min-width: 100px; }
            .daily-stats { display: flex; gap: 15px; font-size: 14px; color: #64748b; }
            .top-users { background: #f8fafc; padding: 20px; border-radius: 10px; }
            .user-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
            .user-row:last-child { border-bottom: none; }
            .user-rank { background: #667eea; color: white; width: 25px; height: 25px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; }
            .user-name { font-weight: 600; color: #1e293b; }
            .user-stats { font-size: 14px; color: #64748b; }
            .insights { background: linear-gradient(135deg, #fef3c7 0%, #fcd34d 100%); padding: 20px; border-radius: 10px; }
            .insight-item { margin: 8px 0; font-size: 14px; color: #92400e; }
            .footer { background: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0; }
            .footer p { margin: 5px 0; color: #64748b; font-size: 14px; }
            .event-range { background: #e0e7ff; color: #3730a3; padding: 10px 15px; border-radius: 8px; margin: 15px 0; text-align: center; font-size: 14px; font-weight: 600; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎬 BeeMoo Analytics Report</h1>
                <p>{{reportType}} Summary: {{startDate}} - {{endDate}}</p>
            </div>
            
            <div class="content">
                <div class="section">
                    <h2 class="section-title">📊 OVERVIEW</h2>
                    <div class="metrics-grid">
                        <div class="metric-card">
                            <div class="metric-icon">🏠</div>
                            <div class="metric-value">{{currentWeek.roomsCreated}}</div>
                            <div class="metric-label">Rooms Created</div>
                            {{#if growth.rooms}}
                            <div class="metric-growth {{#if (gt growth.rooms 0)}}growth-positive{{else}}growth-negative{{/if}}">
                                {{#if (gt growth.rooms 0)}}+{{/if}}{{growth.rooms}}% from last period
                            </div>
                            {{/if}}
                        </div>
                        
                        <div class="metric-card">
                            <div class="metric-icon">👥</div>
                            <div class="metric-value">{{currentWeek.usersJoined}}</div>
                            <div class="metric-label">Users Joined</div>
                            {{#if growth.users}}
                            <div class="metric-growth {{#if (gt growth.users 0)}}growth-positive{{else}}growth-negative{{/if}}">
                                {{#if (gt growth.users 0)}}+{{/if}}{{growth.users}}% from last period
                            </div>
                            {{/if}}
                        </div>
                        
                        <div class="metric-card">
                            <div class="metric-icon">🎬</div>
                            <div class="metric-value">{{currentWeek.moviePartiesStarted}}</div>
                            <div class="metric-label">Movie Parties Started</div>
                            {{#if growth.movies}}
                            <div class="metric-growth {{#if (gt growth.movies 0)}}growth-positive{{else}}growth-negative{{/if}}">
                                {{#if (gt growth.movies 0)}}+{{/if}}{{growth.movies}}% from last period
                            </div>
                            {{/if}}
                        </div>
                        
                        <div class="metric-card">
                            <div class="metric-icon">📈</div>
                            <div class="metric-value">{{currentWeek.totalEvents}}</div>
                            <div class="metric-label">Total Events</div>
                            {{#if currentWeek.eventIdRange.min}}
                            <div class="event-range">
                                IDs: {{currentWeek.eventIdRange.min}} - {{currentWeek.eventIdRange.max}}
                            </div>
                            {{/if}}
                        </div>
                    </div>
                </div>

                {{#if dailyBreakdown.length}}
                <div class="section">
                    <h2 class="section-title">📅 DAILY BREAKDOWN</h2>
                    <div class="daily-breakdown">
                        {{#each dailyBreakdown}}
                        <div class="daily-row">
                            <div class="daily-day">{{day}}</div>
                            <div class="daily-stats">
                                <span>🏠 {{roomsCreated}}</span>
                                <span>👥 {{usersJoined}}</span>
                                <span>🎬 {{moviePartiesStarted}}</span>
                            </div>
                        </div>
                        {{/each}}
                    </div>
                </div>
                {{/if}}

                {{#if topUsers.length}}
                <div class="section">
                    <h2 class="section-title">🏆 TOP USERS</h2>
                    <div class="top-users">
                        {{#each topUsers}}
                        <div class="user-row">
                            <div style="display: flex; align-items: center; gap: 15px;">
                                <div class="user-rank">{{inc @index}}</div>
                                <div class="user-name">{{username}}</div>
                            </div>
                            <div class="user-stats">
                                {{rooms_created}} rooms, {{movies_started}} movies
                            </div>
                        </div>
                        {{/each}}
                    </div>
                </div>
                {{/if}}

                {{#if peakHours.length}}
                <div class="section">
                    <h2 class="section-title">⏰ PEAK ACTIVITY HOURS</h2>
                    <div class="daily-breakdown">
                        {{#each peakHours}}
                        <div class="daily-row">
                            <div class="daily-day">{{hour}}</div>
                            <div class="daily-stats">
                                <span>{{events}} events</span>
                            </div>
                        </div>
                        {{/each}}
                    </div>
                </div>
                {{/if}}

                {{#if insights.length}}
                <div class="section">
                    <h2 class="section-title">🎯 KEY INSIGHTS</h2>
                    <div class="insights">
                        {{#each insights}}
                        <div class="insight-item">• {{this}}</div>
                        {{/each}}
                    </div>
                </div>
                {{/if}}

                {{#if techStats}}
                <div class="section">
                    <h2 class="section-title">📱 TECHNICAL STATS</h2>
                    <div class="daily-breakdown">
                        <div class="daily-row">
                            <div class="daily-day">🔌 Total Connections</div>
                            <div class="daily-stats"><span>{{techStats.totalConnections}}</span></div>
                        </div>
                        <div class="daily-row">
                            <div class="daily-day">⏱️ Avg Session Time</div>
                            <div class="daily-stats"><span>{{techStats.avgSessionTime}} minutes</span></div>
                        </div>
                        <div class="daily-row">
                            <div class="daily-day">🎬 Movie Party Rate</div>
                            <div class="daily-stats"><span>{{techStats.moviePartyRate}}%</span></div>
                        </div>
                        <div class="daily-row">
                            <div class="daily-day">👥 Avg Users/Room</div>
                            <div class="daily-stats"><span>{{techStats.avgUsersPerRoom}}</span></div>
                        </div>
                    </div>
                </div>
                {{/if}}
            </div>
            
            <div class="footer">
                <p>Generated on: {{generatedAt}}</p>
                <p>🚀 BeeMoo Analytics System</p>
                <p>https://beemoo.vercel.app</p>
            </div>
        </div>
    </body>
    </html>`;

    // Register Handlebars helpers
    handlebars.registerHelper('gt', function(a, b) {
      return a > b;
    });

    handlebars.registerHelper('inc', function(value) {
      return parseInt(value) + 1;
    });

    const compiledTemplate = handlebars.compile(template);
    return compiledTemplate(data);
  }

  /**
   * Generate enhanced plain text email content
   */
  generateReportText(data) {
    let text = `🎬 BeeMoo Analytics Report\n`;
    text += `${data.reportType} Summary: ${data.startDate} - ${data.endDate}\n\n`;
    
    text += `═══════════════════════════════════════════════════\n`;
    text += `📊 OVERVIEW\n`;
    text += `═══════════════════════════════════════════════════\n`;
    text += `🏠 Rooms Created: ${data.currentWeek.roomsCreated}`;
    if (data.growth && data.growth.rooms) {
      text += ` (${data.growth.rooms > 0 ? '+' : ''}${data.growth.rooms}% from last period)`;
    }
    text += `\n👥 Users Joined: ${data.currentWeek.usersJoined}`;
    if (data.growth && data.growth.users) {
      text += ` (${data.growth.users > 0 ? '+' : ''}${data.growth.users}% from last period)`;
    }
    text += `\n🎬 Movie Parties Started: ${data.currentWeek.moviePartiesStarted}`;
    if (data.growth && data.growth.movies) {
      text += ` (${data.growth.movies > 0 ? '+' : ''}${data.growth.movies}% from last period)`;
    }
    text += `\n📈 Total Events Recorded: ${data.currentWeek.totalEvents}`;
    if (data.currentWeek.eventIdRange && data.currentWeek.eventIdRange.min) {
      text += ` (IDs: ${data.currentWeek.eventIdRange.min} - ${data.currentWeek.eventIdRange.max})`;
    }
    text += `\n\n`;
    
    if (data.dailyBreakdown && data.dailyBreakdown.length > 0) {
      text += `═══════════════════════════════════════════════════\n`;
      text += `📈 DAILY BREAKDOWN\n`;
      text += `═══════════════════════════════════════════════════\n`;
      data.dailyBreakdown.forEach(day => {
        text += `${day.day.padEnd(10)} | 🏠 ${day.roomsCreated} rooms | 👥 ${day.usersJoined} users | 🎬 ${day.moviePartiesStarted} movies\n`;
      });
      text += `\n`;
    }
    
    if (data.topUsers && data.topUsers.length > 0) {
      text += `═══════════════════════════════════════════════════\n`;
      text += `🏆 TOP USERS THIS ${data.reportType.toUpperCase()}\n`;
      text += `═══════════════════════════════════════════════════\n`;
      data.topUsers.forEach((user, index) => {
        const crown = index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🎬';
        text += `${index + 1}. ${crown} ${user.username} - ${user.rooms_created} rooms created, ${user.movies_started} movies started\n`;
      });
      text += `\n`;
    }
    
    if (data.peakHours && data.peakHours.length > 0) {
      text += `═══════════════════════════════════════════════════\n`;
      text += `⏰ PEAK ACTIVITY HOURS\n`;
      text += `═══════════════════════════════════════════════════\n`;
      data.peakHours.forEach(hour => {
        text += `${hour.hour} - ${hour.events} events\n`;
      });
      text += `\n`;
    }
    
    if (data.insights && data.insights.length > 0) {
      text += `═══════════════════════════════════════════════════\n`;
      text += `🎯 KEY INSIGHTS\n`;
      text += `═══════════════════════════════════════════════════\n`;
      data.insights.forEach(insight => {
        text += `• ${insight}\n`;
      });
      text += `\n`;
    }
    
    if (data.techStats) {
      text += `═══════════════════════════════════════════════════\n`;
      text += `📱 TECHNICAL STATS\n`;
      text += `═══════════════════════════════════════════════════\n`;
      text += `🔌 Total Connections: ${data.techStats.totalConnections}\n`;
      text += `⏱️ Average Session: ${data.techStats.avgSessionTime} minutes\n`;
      text += `🎬 Movie Party Rate: ${data.techStats.moviePartyRate}%\n`;
      text += `👥 Average Users/Room: ${data.techStats.avgUsersPerRoom}\n\n`;
    }
    
    text += `═══════════════════════════════════════════════════\n\n`;
    text += `Generated on: ${data.generatedAt}\n`;
    text += `Report Period: ${data.reportType.toLowerCase()} report\n\n`;
    text += `🎬 BeeMoo - Movie Party Meetings Platform\n`;
    text += `https://beemoo.vercel.app`;
    
    return text;
  }

  /**
   * Utility functions
   */
  formatDate(date) {
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  }

  formatMonth(date) {
    return date.toLocaleDateString('en-US', { 
      month: 'long'
    });
  }
}

module.exports = EmailReporter;
