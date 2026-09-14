import fs from 'node:fs';
import path from 'node:path';

const rawData = fs.readFileSync('scratch/extracted_contacts.json', 'utf8');
const channels = JSON.parse(rawData);

const artifactDir = 'C:/Users/kabir/.gemini/antigravity-ide/brain/0535e42d-77d2-4097-8963-b5873a80f645';
const reportPath = path.join(artifactDir, 'telegram_contacts_report.md');

let md = `# Telegram Channel Contacts Extraction Report\n\n`;
md += `This report lists the extracted contact information from **${channels.length}** monitored Telegram channels. We fetched their public web preview profiles to extract owner or support contact handles.\n\n`;

md += `> [!IMPORTANT]\n`;
md += `> **Spam Warning & Rate Limits:** Messaging **${channels.filter(c => c.contacts.length > 0).length}** contacts simultaneously from one Telegram account will trigger Telegram's anti-spam security and likely result in an immediate and permanent ban of your Telegram account. It is highly recommended to message them gradually (e.g., with random delays of 2-5 minutes between messages) and personalize each outreach.\n\n`;

md += `## Summary Statistics\n`;
md += `- **Total Monitored Channels:** ${channels.length}\n`;
md += `- **Public Channels Searched:** ${channels.filter(c => c.status !== 'skipped (private/invite link)').length}\n`;
md += `- **Private/Invite Channels (Skipped):** ${channels.filter(c => c.status === 'skipped (private/invite link)').length}\n`;
md += `- **Channels with Extracted Contacts:** ${channels.filter(c => c.contacts.length > 0).length}\n`;
const totalContacts = channels.reduce((acc, c) => acc + c.contacts.length, 0);
md += `- **Total Extracted Contact Handles:** ${totalContacts}\n\n`;

md += `## Extracted Contacts\n\n`;
md += `| Channel Name | Channel Username | Contact Handle(s) | Bio DescriptionSnippet |\n`;
md += `| :--- | :--- | :--- | :--- |\n`;

for (const c of channels) {
  if (c.contacts.length > 0) {
    const contactLinks = c.contacts.map(handle => {
      const cleanHandle = handle.replace(/^@/, '');
      return `[${handle}](https://t.me/${cleanHandle})`;
    }).join(', ');

    const descSnippet = c.description
      ? c.description.replace(/\s+/g, ' ').substring(0, 120) + (c.description.length > 120 ? '...' : '')
      : '*No Bio*';

    md += `| **${c.title || c.ref}** | [@${c.username}](https://t.me/${c.username}) | ${contactLinks} | *${descSnippet}* |\n`;
  }
}

md += `\n\n## Public Channels Without Contact Details in Bio\n\n`;
md += `These channels are public but did not specify an owner or support username in their bio description:\n\n`;
md += `| Channel Name | Channel Username |\n`;
md += `| :--- | :--- |\n`;

for (const c of channels) {
  if (c.status === 'success' && c.contacts.length === 0) {
    md += `| **${c.title || c.ref}** | [@${c.username}](https://t.me/${c.username}) |\n`;
  }
}

md += `\n\n## Private / Invite-Only Channels (Skipped)\n\n`;
md += `These invite links cannot be scraped from the web preview without joining the channel:\n\n`;
md += `| Channel / Invite Link |\n`;
md += `| :--- |\n`;

for (const c of channels) {
  if (c.status.includes('skipped')) {
    md += `| [${c.ref}](${c.ref}) |\n`;
  }
}

fs.writeFileSync(reportPath, md, 'utf8');
console.log(`Markdown report generated successfully at ${reportPath}`);
