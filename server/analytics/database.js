const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class AnalyticsDatabase {
  constructor() {
    const dbPath = path.join(__dirname, 'beemoo_analytics.db');
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Analytics database connection error:', err);
      } else {
        console.log('📊 Analytics database connected');
        this.initializeTables();
      }
    });
  }

  /**
   * Initialize database tables
   */
  initializeTables() {
    const createAnalyticsTable = `
      CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code TEXT,
        event_type TEXT NOT NULL,
        username TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db.run(createAnalyticsTable, (err) => {
      if (err) {
        console.error('❌ Error creating analytics table:', err);
      } else {
        console.log('✅ Analytics table ready');
      }
    });
  }

  /**
   * Record an analytics event
   * @param {string} eventType - Type of event (room_created, user_joined, movie_started)
   * @param {string} roomCode - Room code if applicable
   * @param {string} username - Username if applicable
   * @param {object} metadata - Additional event data
   */
  recordEvent(eventType, roomCode = null, username = null, metadata = {}) {
    const metadataJson = JSON.stringify(metadata);
    
    const sql = `
      INSERT INTO analytics_events (event_type, room_code, username, metadata)
      VALUES (?, ?, ?, ?)
    `;

    this.db.run(sql, [eventType, roomCode, username, metadataJson], function(err) {
      if (err) {
        console.error('❌ Error recording analytics event:', err);
      } else {
        console.log(`📊 Analytics: ${eventType} recorded (ID: ${this.lastID})`);
      }
    });
  }

  /**
   * Get analytics data for a date range
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Promise}
   */
  getAnalytics(startDate, endDate) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          event_type,
          COUNT(*) as count,
          COUNT(DISTINCT room_code) as unique_rooms,
          COUNT(DISTINCT username) as unique_users
        FROM analytics_events 
        WHERE timestamp BETWEEN ? AND ?
        GROUP BY event_type
      `;

      this.db.all(sql, [startDate.toISOString(), endDate.toISOString()], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Get detailed analytics for reporting
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Promise}
   */
  getDetailedAnalytics(startDate, endDate) {
    return new Promise((resolve, reject) => {
      const queries = {
        // Total rooms created
        roomsCreated: `
          SELECT COUNT(*) as count 
          FROM analytics_events 
          WHERE event_type = 'room_created' 
          AND timestamp BETWEEN ? AND ?
        `,
        
        // Total users who joined rooms
        usersJoined: `
          SELECT COUNT(*) as count 
          FROM analytics_events 
          WHERE event_type = 'user_joined' 
          AND timestamp BETWEEN ? AND ?
        `,
        
        // Rooms that started movies
        moviePartiesStarted: `
          SELECT COUNT(DISTINCT room_code) as count 
          FROM analytics_events 
          WHERE event_type = 'movie_started' 
          AND timestamp BETWEEN ? AND ?
        `,
        
        // Most active users
        topUsers: `
          SELECT username, COUNT(*) as activity_count
          FROM analytics_events 
          WHERE username IS NOT NULL 
          AND timestamp BETWEEN ? AND ?
          GROUP BY username 
          ORDER BY activity_count DESC 
          LIMIT 5
        `,
        
        // Peak usage hours
        peakHours: `
          SELECT 
            strftime('%H', timestamp) as hour,
            COUNT(*) as events
          FROM analytics_events 
          WHERE timestamp BETWEEN ? AND ?
          GROUP BY hour 
          ORDER BY events DESC 
          LIMIT 3
        `
      };

      const results = {};
      const dateParams = [startDate.toISOString(), endDate.toISOString()];

      // Execute all queries
      Promise.all([
        new Promise((res, rej) => {
          this.db.get(queries.roomsCreated, dateParams, (err, row) => {
            err ? rej(err) : res(['roomsCreated', row?.count || 0]);
          });
        }),
        new Promise((res, rej) => {
          this.db.get(queries.usersJoined, dateParams, (err, row) => {
            err ? rej(err) : res(['usersJoined', row?.count || 0]);
          });
        }),
        new Promise((res, rej) => {
          this.db.get(queries.moviePartiesStarted, dateParams, (err, row) => {
            err ? rej(err) : res(['moviePartiesStarted', row?.count || 0]);
          });
        }),
        new Promise((res, rej) => {
          this.db.all(queries.topUsers, dateParams, (err, rows) => {
            err ? rej(err) : res(['topUsers', rows || []]);
          });
        }),
        new Promise((res, rej) => {
          this.db.all(queries.peakHours, dateParams, (err, rows) => {
            err ? rej(err) : res(['peakHours', rows || []]);
          });
        })
      ])
      .then(queryResults => {
        queryResults.forEach(([key, value]) => {
          results[key] = value;
        });
        resolve(results);
      })
      .catch(reject);
    });
  }

  /**
   * Close database connection
   */
  close() {
    this.db.close((err) => {
      if (err) {
        console.error('❌ Error closing analytics database:', err);
      } else {
        console.log('📊 Analytics database connection closed');
      }
    });
  }
}

module.exports = AnalyticsDatabase;
