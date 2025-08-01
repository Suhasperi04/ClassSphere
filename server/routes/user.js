const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');

dotenv.config();

const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
    credential: admin.credential.cert(firebaseConfig),
    databaseURL: "https://fingerprint-91d3d-default-rtdb.firebaseio.com"
});

// User schema
const userSchema = new mongoose.Schema({
    id: String,
    name: String,
    age: Number,
    email: String
});

const User = mongoose.model('User', userSchema);

// UserLog schema
const userLogSchema = new mongoose.Schema({
    date: String, // Store date as a string in 'YYYY-MM-DD' format
    logs: [
        {
            id: String,
            name: String,
            course: String, // Added course field for data logs
            timestamp: { type: Date, default: Date.now }
        }
    ]
});

const UserLog = mongoose.model('UserLog', userLogSchema);

// Root route
router.get('/', async (req, res) => {
    res.json({ message: "User API is working!", timestamp: new Date().toISOString() });
});

// Register a new user
router.post('/register', async (req, res) => {
    const { id, name, age, email } = req.body;
    try {
        console.log(`Registration request received for ID: ${id}`);
        console.log('Request body:', req.body);
        
        // Convert ID to string for consistent comparison
        const idStr = String(id);
        console.log(`Converted ID to string: ${idStr}`);
        
        // Check if user exists by ID (as string)
        const existingUser = await User.findOne({ id: idStr });
        console.log(`Database check result: ${existingUser ? 'User found' : 'User not found'}`);
        
        let userToUpdate;
        if (existingUser) {
            console.log(`Updating existing user with ID ${idStr}`);
            userToUpdate = existingUser;
        } else {
            console.log(`Creating new user with ID ${idStr}`);
            userToUpdate = new User({ id: idStr, name, age, email });
        }
        
        // Update user data
        userToUpdate.name = name;
        userToUpdate.age = age;
        userToUpdate.email = email;
        
        console.log(`Attempting to save user: ${JSON.stringify(userToUpdate.toObject())}`);
        await userToUpdate.save();
        console.log(`User saved successfully. ID: ${idStr}, Name: ${name}`);
        
        // Sync name to Firebase RTDB for ESP32 LCD
        try {
            await admin.database().ref(`/users/${idStr}/name`).set(name);
            console.log(`Name synced to Firebase for user ${idStr}`);
        } catch (firebaseErr) {
            console.error('Failed to sync name to Firebase RTDB:', firebaseErr);
        }
        
        res.status(201).send('User registered successfully');
    } catch (error) {
        console.error('Error registering user:', error);
        console.error('Error details:', error.message);
        res.status(400).send('Error registering user');
    }
});

// Update a user's name (if you have a PUT/PATCH route)
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, age, email } = req.body;
    try {
        const user = await User.findOneAndUpdate({ id }, { name, age, email }, { new: true });
        if (!user) {
            return res.status(404).send('User not found');
        }
        // Sync updated name to Firebase RTDB
        try {
            await admin.database().ref(`/users/${id}/name`).set(name);
        } catch (firebaseErr) {
            console.error('Failed to sync updated name to Firebase RTDB:', firebaseErr);
        }
        res.json(user);
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(400).send('Error updating user');
    }
});

// Check user and log the entry by date
router.post('/check', async (req, res) => {
    const { id } = req.body;

    try {
        // Find the user in MongoDB by ID
        const user = await User.findOne({ id });

        if (!user) {
            return res.status(404).send('User not found');
        }

        // Get the current date in 'YYYY-MM-DD' format
        const currentDate = new Date().toISOString().split('T')[0];

        // Find or create a log for the current date
        let userLog = await UserLog.findOne({ date: currentDate });
        if (!userLog) {
            userLog = new UserLog({ date: currentDate, logs: [] });
        }

        // Create a log entry with timestamp
        const logEntry = { id: user.id, name: user.name, course: "Default Course", timestamp: new Date() };

        // Add the log entry to the logs array
        userLog.logs.push(logEntry);

        // Save the log
        await userLog.save();

        // Send the log entry back to the client
        res.status(200).json(logEntry);
    } catch (error) {
        console.error('Error checking user:', error);
        res.status(400).send('Error checking user');
    }
});

// Fetch logs for a specific date
router.get('/:date', async (req, res) => {
    const { date } = req.params;    
    try {
        const userLog = await UserLog.findOne({ date });
        if (userLog) {
            res.json(userLog.logs);
        } else {
            res.json([]); // Always return JSON, even if empty
        }
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(400).send('Error fetching logs');
    }
});

// Assign course to logs within a time range and remove duplicates only within that range (including teacher id 1)
router.post('/assign-course', async (req, res) => {
    const { date, fromTime, toTime, course } = req.body;
    if (!date || !fromTime || !toTime || !course) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }
    try {
        const userLog = await UserLog.findOne({ date });
        if (!userLog) {
            return res.status(404).json({ error: 'No logs found for this date.' });
        }
        const from = new Date(`${date}T${fromTime}`);
        const to = new Date(`${date}T${toTime}`);
        let updatedCount = 0;
        const seenIds = new Set();
        // Separate logs into in-range and out-of-range
        const inRange = [];
        const outRange = [];
        for (const log of userLog.logs) {
            if (!log.timestamp) {
                outRange.push(log);
                continue;
            }
            const logTime = new Date(log.timestamp);
            if (logTime >= from && logTime <= to) {
                inRange.push(log);
            } else {
                outRange.push(log);
            }
        }
        // Deduplicate in-range logs by id (including teacher), keep first occurrence
        const dedupedInRange = [];
        for (const log of inRange) {
            if (!seenIds.has(log.id)) {
                log.course = course;
                dedupedInRange.push(log);
                seenIds.add(log.id);
                updatedCount++;
            }
            // else: skip duplicate in range
        }
        // Merge back
        userLog.logs = [...outRange, ...dedupedInRange];
        await userLog.save();
        res.json({ message: `Course assigned to ${updatedCount} log(s) in the selected time range.` });
    } catch (error) {
        console.error('Error assigning course:', error);
        res.status(500).json({ error: 'Failed to assign course.' });
    }
});

// Send mail to students with attendance < 75%
router.post('/send-mail', async (req, res) => {
    const { fromDate, toDate, course } = req.body;
    if (!fromDate || !toDate || !course) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }
    try {
        // Find all logs in the date range for the course
        const logs = await UserLog.find({
            date: { $gte: fromDate, $lte: toDate }
        });
        // Flatten all logs for the range
        let allLogs = [];
        logs.forEach(logDoc => {
            allLogs = allLogs.concat(logDoc.logs.filter(l => l.course === course));
        });
        // Total classes = logs with id == 1 (teacher)
        const totalClasses = allLogs.filter(l => l.id === '1' || l.id === 1).length;
        if (totalClasses === 0) {
            return res.status(400).json({ error: 'No classes found for this course in the selected range.' });
        }
        // Get all student ids (exclude teacher)
        const studentIds = [...new Set(allLogs.filter(l => l.id !== '1' && l.id !== 1).map(l => l.id))];
        
        let sentCount = 0;
        let belowList = [];
        
        // Check if email configuration is available
        const hasEmailConfig = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.FROM_EMAIL;
        
        let transporter = null;
        if (hasEmailConfig) {
            try {
                // Determine if secure should be true (port 465) or false (port 587 or others)
                const smtpPort = parseInt(process.env.SMTP_PORT, 10) || 587;
                const isSecure = smtpPort === 465;
                // Log SMTP config for debugging (do not log password)
                console.log('SMTP config:', {
                    host: process.env.SMTP_HOST,
                    port: smtpPort,
                    user: process.env.SMTP_USER,
                    secure: isSecure
                });
                transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: smtpPort,
                    secure: isSecure, // true for 465, false for other ports
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS
                    },
                    connectionTimeout: 10000 // 10 seconds
                });
            } catch (emailError) {
                console.error('Failed to create email transporter:', emailError);
            }
        }
        
        for (const studentId of studentIds) {
            // Attended classes for this student
            const attended = allLogs.filter(l => l.id == studentId).length;
            const percent = (attended / totalClasses) * 100;
            if (percent < 75) {
                // Get student email
                const student = await User.findOne({ id: studentId });
                if (student && student.email) {
                    belowList.push({ 
                        id: studentId, 
                        name: student.name, 
                        email: student.email, 
                        percent: percent.toFixed(2), 
                        attended, 
                        totalClasses 
                    });
                    
                    // Try to send email if transporter is available
                    if (transporter) {
                        try {
                            const subject = `Attendance Shortage Notice for ${course}`;
                            const body = `Dear ${student.name},\n\nThis is to inform you that your attendance in the course "${course}" is below the required threshold.\n\nAttendance Details:\n- Total Classes Conducted: ${totalClasses}\n- Classes Attended: ${attended}\n- Attendance Percentage: ${percent.toFixed(2)}%\n\nAs per the academic policy, a minimum of 75% attendance is required to be eligible for examinations and course completion.\n\nPlease take necessary steps to improve your attendance. If you have any concerns or require assistance, contact your course instructor.\n\nRegards,\nClassMate Attendance System`;
                            await transporter.sendMail({
                                from: process.env.FROM_EMAIL,
                                to: student.email,
                                subject,
                                text: body
                            });
                            sentCount++;
                        } catch (emailError) {
                            console.error(`Failed to send email to ${student.email}:`, emailError);
                        }
                    }
                }
            }
        }
        
        if (hasEmailConfig && transporter) {
            res.json({ 
                message: `Emails sent to ${sentCount} student(s) with attendance below 75%.`, 
                belowList 
            });
        } else {
            res.json({ 
                message: `Found ${belowList.length} student(s) with attendance below 75%. Email configuration not available.`, 
                belowList 
            });
        }
    } catch (error) {
        console.error('Error processing send-mail request:', error);
        res.status(500).json({ error: 'Failed to process request.' });
    }
});

// Delete a user by id and remove their logs from UserLog (even if user not found)
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const userResult = await User.deleteOne({ id });
        // Remove logs with this id from all UserLog documents
        const logResult = await UserLog.updateMany({}, { $pull: { logs: { id: id } } });
        let message = '';
        if (userResult.deletedCount === 0) {
            message += `User with id ${id} not found. `;
        } else {
            message += `User with id ${id} deleted. `;
        }
        if (logResult.modifiedCount > 0) {
            message += `Logs with id ${id} deleted from ${logResult.modifiedCount} day(s).`;
        } else {
            message += `No logs with id ${id} found.`;
        }
        res.json({ message });
    } catch (error) {
        console.error('Error deleting user/logs:', error);
        res.status(500).json({ error: 'Failed to delete user and/or logs.' });
    }
});

module.exports = router;
