const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const userRoutes = require('./routes/user');

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// Connect to MongoDB
async function connectDB() {
    try {
        if (!process.env.MONGODB_URI) {
            console.error('MONGODB_URI environment variable is not set!');
            return false;
        }
        
        // Connection options
        const options = {
            serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds
            socketTimeoutMS: 45000,
            family: 4 // Use IPv4
        };
        
        await mongoose.connect(process.env.MONGODB_URI, options);
        console.log("CONNECTED TO DATABASE SUCCESSFULLY");
        return true;
    } catch (error) {
        console.error('COULD NOT CONNECT TO DATABASE:', error.message);
        console.error('Full error:', error);
        return false;
    }
}

// Initialize database connection
connectDB();

// API routes
app.use('/api/users', userRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' });
});

// Handle 404 for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

// Export for Vercel
module.exports = app;
