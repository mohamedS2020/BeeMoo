// BeeMoo - Subtitle Parser Utility
// Handles parsing and managing subtitle files (.srt, .vtt)

export class SubtitleParser {
  constructor() {
    this.subtitles = [];
    this.currentSubtitle = null;
    this.isEnabled = true;
  }

  /**
   * Parse subtitle file content
   * Supports .srt, .vtt, and .ass formats
   */
  parse(content, format = 'auto') {
    try {
      const detectedFormat = format === 'auto' ? this.detectFormat(content) : format;
      
      switch (detectedFormat) {
        case 'srt':
          return this.parseSRT(content);
        case 'vtt':
          return this.parseVTT(content);
        case 'ass':
          return this.parseASS(content);
        default:
          throw new Error(`Unsupported subtitle format: ${detectedFormat}`);
      }
    } catch (error) {
      console.error('❌ Subtitle parsing failed:', error);
      throw error;
    }
  }

  /**
   * Auto-detect subtitle format
   */
  detectFormat(content) {
    if (content.trim().startsWith('WEBVTT')) {
      return 'vtt';
    }
    // Check for ASS/SSA format
    if (content.includes('[Script Info]') || content.includes('[V4+ Styles]') || content.includes('[Events]')) {
      return 'ass';
    }
    // Check for SRT pattern (number followed by timestamp)
    if (/^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/m.test(content)) {
      return 'srt';
    }
    return 'srt'; // Default to SRT
  }

  /**
   * Parse SRT format
   */
  parseSRT(content) {
    const subtitles = [];
    const blocks = content.trim().split(/\n\s*\n/);

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 3) continue;

      const index = parseInt(lines[0].trim());
      if (isNaN(index)) continue;

      const timeMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
      if (!timeMatch) continue;

      const startTime = this.parseTime(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
      const endTime = this.parseTime(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
      const text = lines.slice(2).join('\n').trim();

      subtitles.push({
        index,
        startTime,
        endTime,
        text: this.cleanText(text),
        duration: endTime - startTime
      });
    }

    this.subtitles = subtitles.sort((a, b) => a.startTime - b.startTime);
    console.log(`✅ Parsed ${this.subtitles.length} SRT subtitles`);
    return this.subtitles;
  }

  /**
   * Parse VTT format
   */
  parseVTT(content) {
    const subtitles = [];
    const lines = content.split('\n');
    let index = 0;
    let currentCue = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip WEBVTT header and empty lines
      if (!line || line === 'WEBVTT' || line.startsWith('NOTE')) continue;

      // Check for timestamp line
      const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
      if (timeMatch) {
        const startTime = this.parseTime(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
        const endTime = this.parseTime(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
        
        currentCue = {
          index: ++index,
          startTime,
          endTime,
          text: '',
          duration: endTime - startTime
        };
        continue;
      }

      // Collect text lines for current cue
      if (currentCue && line) {
        currentCue.text += (currentCue.text ? '\n' : '') + line;
      }

      // End of cue (empty line or end of file)
      if (currentCue && (!line || i === lines.length - 1)) {
        currentCue.text = this.cleanText(currentCue.text);
        if (currentCue.text) {
          subtitles.push(currentCue);
        }
        currentCue = null;
      }
    }

    this.subtitles = subtitles.sort((a, b) => a.startTime - b.startTime);
    console.log(`✅ Parsed ${this.subtitles.length} VTT subtitles`);
    return this.subtitles;
  }

  /**
   * Parse ASS (Advanced SubStation Alpha) format
   */
  parseASS(content) {
    const subtitles = [];
    const lines = content.split('\n');
    let inEvents = false;
    let formatLine = null;
    let index = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Look for Events section
      if (trimmedLine === '[Events]') {
        inEvents = true;
        continue;
      }
      
      // Stop processing if we hit another section
      if (inEvents && trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
        break;
      }
      
      // Get format definition
      if (inEvents && trimmedLine.startsWith('Format:')) {
        formatLine = trimmedLine.substring(7).trim();
        continue;
      }
      
      // Process dialogue lines
      if (inEvents && trimmedLine.startsWith('Dialogue:')) {
        if (!formatLine) continue;
        
        const dialogueData = trimmedLine.substring(9).trim();
        const fields = this.parseASSDialogue(dialogueData, formatLine);
        
        if (fields && fields.Start && fields.End && fields.Text) {
          const startTime = this.parseASSTime(fields.Start);
          const endTime = this.parseASSTime(fields.End);
          
          subtitles.push({
            index: ++index,
            startTime,
            endTime,
            text: this.cleanASSText(fields.Text),
            duration: endTime - startTime
          });
        }
      }
    }

    this.subtitles = subtitles.sort((a, b) => a.startTime - b.startTime);
    console.log(`✅ Parsed ${this.subtitles.length} ASS subtitles`);
    return this.subtitles;
  }

  /**
   * Parse ASS dialogue line based on format
   */
  parseASSDialogue(dialogueData, formatLine) {
    const formatFields = formatLine.split(',').map(field => field.trim());
    const values = dialogueData.split(',');
    const result = {};
    
    for (let i = 0; i < formatFields.length && i < values.length; i++) {
      const fieldName = formatFields[i];
      let value = values[i];
      
      // Handle Text field which may contain commas
      if (fieldName === 'Text' && i < values.length) {
        value = values.slice(i).join(',');
        result[fieldName] = value.trim();
        break;
      }
      
      result[fieldName] = value.trim();
    }
    
    return result;
  }

  /**
   * Parse ASS time format (H:MM:SS.CC)
   */
  parseASSTime(timeStr) {
    const match = timeStr.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
    if (!match) return 0;
    
    const hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const seconds = parseInt(match[3]);
    const centiseconds = parseInt(match[4]);
    
    return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
  }

  /**
   * Clean ASS text (remove style tags, positioning)
   */
  cleanASSText(text) {
    return text
      .replace(/\\N/g, '\n')           // Line breaks
      .replace(/\\n/g, '\n')           // Line breaks
      .replace(/\\h/g, ' ')            // Hard space
      .replace(/\{[^}]*\}/g, '')       // Remove style tags like {\i1}, {\b1}
      .replace(/\\[a-zA-Z]+\([^)]*\)/g, '') // Remove commands like \pos(x,y)
      .replace(/\\[a-zA-Z]+/g, '')     // Remove other commands
      .replace(/\s+/g, ' ')            // Normalize whitespace
      .trim();
  }

  /**
   * Convert time components to seconds
   */
  parseTime(hours, minutes, seconds, milliseconds) {
    return parseInt(hours) * 3600 + 
           parseInt(minutes) * 60 + 
           parseInt(seconds) + 
           parseInt(milliseconds) / 1000;
  }

  /**
   * Clean subtitle text (remove HTML tags, extra whitespace)
   */
  cleanText(text) {
    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&lt;/g, '<')   // Decode HTML entities
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim();
  }

  /**
   * Get subtitle for specific time
   */
  getSubtitleAtTime(currentTime) {
    if (!this.isEnabled || !this.subtitles.length) return null;

    const subtitle = this.subtitles.find(sub => 
      currentTime >= sub.startTime && currentTime <= sub.endTime
    );

    // Update current subtitle if changed
    if (subtitle !== this.currentSubtitle) {
      this.currentSubtitle = subtitle;
      return { subtitle, changed: true };
    }

    return { subtitle, changed: false };
  }

  /**
   * Get all subtitles
   */
  getAllSubtitles() {
    return this.subtitles;
  }

  /**
   * Enable/disable subtitles
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.currentSubtitle = null;
    }
  }

  /**
   * Clear all subtitles
   */
  clear() {
    this.subtitles = [];
    this.currentSubtitle = null;
  }

  /**
   * Export subtitles as JSON for network transmission
   */
  export() {
    return {
      subtitles: this.subtitles,
      isEnabled: this.isEnabled,
      count: this.subtitles.length
    };
  }

  /**
   * Import subtitles from JSON
   */
  import(data) {
    if (data && Array.isArray(data.subtitles)) {
      this.subtitles = data.subtitles;
      this.isEnabled = data.isEnabled !== false;
      this.currentSubtitle = null;
      console.log(`✅ Imported ${this.subtitles.length} subtitles`);
      return true;
    }
    return false;
  }

  /**
   * Validate subtitle file
   */
  static validateFile(file) {
    const validExtensions = ['.srt', '.vtt', '.ass'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!file) {
      throw new Error('No file provided');
    }

    const extension = '.' + file.name.split('.').pop().toLowerCase();
    if (!validExtensions.includes(extension)) {
      throw new Error(`Invalid file type. Supported: ${validExtensions.join(', ')}`);
    }

    if (file.size > maxSize) {
      throw new Error('File too large. Maximum size: 5MB');
    }

    return true;
  }
}
