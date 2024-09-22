const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const session = require('express-session'); // Ensure you're using sessions to store the codeVerifier
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Session middleware setup
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
  }));


// Supabase configuration
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);


// Salesforce OAuth credentials (from your Connected App)
const CLIENT_ID = process.env.SALESFORCE_CLIENT_ID;
const CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/oauth/callback'; // Your callback URL

// Welcome Page for route '/'
app.get('/', (req, res) => {
    res.send('Welcome to the Salesforce Metadata App!');
});

// Route to start the OAuth flow
app.get('/login', (req, res) => {
    // Generate code verifier and challenge for PKCE
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    
    // Store code verifier in session
    req.session.codeVerifier = codeVerifier;
  
    const authUrl = `https://login.salesforce.com/services/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    res.redirect(authUrl);
});
  

// Route to handle OAuth callback
app.get('/oauth/callback', async (req, res) => {
    const code = req.query.code; // Authorization code from Salesforce
    const codeVerifier = req.session.codeVerifier; // Retrieve code verifier from session
  
    if (!code || !codeVerifier) {
      return res.status(400).send('Missing authorization code or code verifier');
    }
  
    try {
      const tokenResponse = await fetch('https://login.salesforce.com/services/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: process.env.SALESFORCE_CLIENT_ID,
          client_secret: process.env.SALESFORCE_CLIENT_SECRET,
          redirect_uri: process.env.REDIRECT_URI,
          code: code,
          code_verifier: codeVerifier, // Include code verifier for PKCE
        }),
      });
  
      if (!tokenResponse.ok) {
        throw new Error('Failed to fetch tokens');
      }
  
      const tokenData = await tokenResponse.json();
  
      req.session.accessToken = tokenData.access_token;
      req.session.instanceUrl = tokenData.instance_url;
  
      res.send('OAuth2 flow complete! You can now fetch metadata.');
    } catch (error) {
      res.status(500).send('Error during OAuth2 callback: ' + error.message);
    }
  });

  // Route to get and store Salesforce metadata
  app.get('/store-metadata', async (req, res) => {
    const accessToken = req.session.accessToken; // Retrieve access token from session
    const instanceUrl = req.session.instanceUrl; // Retrieve instance URL from session
  
    if (!accessToken || !instanceUrl) {
      return res.status(400).send('Missing access token or instance URL. Please complete the OAuth2 flow first.');
    }
  
    // Log the instance URL and access token
    console.log('Instance URL:', instanceUrl);
    console.log('Access Token:', accessToken);
  
    try {
      // Fetch metadata from Salesforce
      const response = await fetch(`${instanceUrl}/services/data/v57.0/sobjects`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
  
      if (!response.ok) {
        console.error('Failed to fetch metadata:', await response.text());
        throw new Error('Failed to fetch metadata from Salesforce');
      }
  
      const metadata = await response.json();
  
      // Store metadata in Supabase
      const { data, error } = await supabase
        .from('metadata')
        .insert([{ json_data: JSON.stringify(metadata) }]);
  
      if (error) {
        return res.status(500).send('Failed to store metadata: ' + error.message);
      }
  
      res.status(200).send('Metadata stored successfully!');
    } catch (error) {
      res.status(500).send('Error fetching or storing metadata: ' + error.message);
    }
  });

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});