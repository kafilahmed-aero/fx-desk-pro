import fs from 'node:fs';
import path from 'node:path';
import { monitoredTelegramChannels } from '../src/config/telegramChannels.js';

// Helper to decode basic HTML entities
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/\\n/g, '\n');
}

async function scrapeChannels() {
  console.log(`Starting extraction for ${monitoredTelegramChannels.length} configured channels...\n`);
  
  const results = [];
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  
  let count = 0;
  for (const channel of monitoredTelegramChannels) {
    count++;
    
    // Skip channels without public usernames (e.g., invite links)
    if (!channel.username) {
      console.log(`[${count}/${monitoredTelegramChannels.length}] Skipping private/invite channel: ${channel.title || channel.ref}`);
      results.push({
        ref: channel.ref,
        title: channel.title,
        username: null,
        description: null,
        contacts: [],
        status: 'skipped (private/invite link)'
      });
      continue;
    }

    const username = channel.username.trim();
    console.log(`[${count}/${monitoredTelegramChannels.length}] Fetching public info for @${username}...`);
    
    try {
      const url = `https://t.me/${username}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!res.ok) {
        throw new Error(`HTTP status ${res.status}`);
      }

      const html = await res.text();

      // Extract title from og:title or title tag
      let title = channel.title;
      const titleMatch = html.match(/<meta property="og:title" content="([^"]*)"/i);
      if (titleMatch && titleMatch[1]) {
        title = decodeHtmlEntities(titleMatch[1]);
      }

      // Extract description from og:description
      let description = '';
      const descMatch = html.match(/<meta property="og:description" content="([\s\S]*?)"/i) || 
                        html.match(/<meta name="description" content="([\s\S]*?)"/i);
      if (descMatch && descMatch[1]) {
        description = decodeHtmlEntities(descMatch[1]);
      }

      // Ignore default telegram descriptions like "You can view and join @channel right away."
      const defaultDescPattern = new RegExp(`You can view and join @${username} right away`, 'i');
      if (defaultDescPattern.test(description) || description.includes("right away.o")) {
        description = '';
      }

      // Extract contacts (@username and t.me/username) from the description
      const contacts = [];
      
      // Find all @usernames
      const usernameRegex = /@([A-Za-z0-9_]{5,32})/g;
      let match;
      while ((match = usernameRegex.exec(description)) !== null) {
        const found = match[1];
        // Filter out the channel's own username and standard noise
        if (found.toLowerCase() !== username.toLowerCase() && !contacts.includes(`@${found}`)) {
          contacts.push(`@${found}`);
        }
      }

      // Find all t.me links
      const tmeRegex = /(?:t\.me|telegram\.me)\/([A-Za-z0-9_+]{5,32})/gi;
      while ((match = tmeRegex.exec(description)) !== null) {
        const found = match[1];
        if (found.toLowerCase() !== username.toLowerCase() && found !== 's' && !contacts.includes(`t.me/${found}`)) {
          // If it is just a username, save as @username, else save as t.me link
          if (!found.startsWith('+')) {
            if (!contacts.includes(`@${found}`)) {
              contacts.push(`@${found}`);
            }
          } else {
            contacts.push(`t.me/${found}`);
          }
        }
      }

      results.push({
        ref: channel.ref,
        title: title,
        username: username,
        description: description || null,
        contacts: contacts,
        status: 'success'
      });

      console.log(`   -> Found ${contacts.length} contact handles: ${contacts.join(', ') || 'none'}`);

    } catch (error) {
      console.log(`   -> Error scraping: ${error.message}`);
      results.push({
        ref: channel.ref,
        title: channel.title,
        username: username,
        description: null,
        contacts: [],
        status: `failed (${error.message})`
      });
    }

    // Wait 1 second to avoid rate limiting
    await delay(1000);
  }

  // Save the result to a JSON file
  const outputPath = path.resolve(process.cwd(), 'scratch/extracted_contacts.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
  
  console.log(`\nScraping complete. Extracted contacts saved to ${outputPath}`);
  
  // Print summary
  const successCount = results.filter(r => r.status === 'success').length;
  const withContactsCount = results.filter(r => r.contacts.length > 0).length;
  const totalContacts = results.reduce((acc, r) => acc + r.contacts.length, 0);
  console.log(`Summary:\n- Successfully fetched: ${successCount}\n- Channels with contacts: ${withContactsCount}\n- Total contact handles extracted: ${totalContacts}`);
}

scrapeChannels().catch(console.error);
