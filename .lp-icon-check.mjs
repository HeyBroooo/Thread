import * as lucide from 'lucide-react';
const keys = Object.keys(lucide);
const hits = keys.filter((k) => /github/i.test(k));
console.log('hits:', hits.join(', '));
console.log('hasGithub:', hits.includes('Github'));
