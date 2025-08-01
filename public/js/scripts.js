const firebaseConfig = {
    apiKey: "AIzaSyDpf8wdB29v3r420hGKC4_dZrDI_SX29Mo",
    authDomain: "fingerprint-91d3d.firebaseapp.com",
    databaseURL: "https://fingerprint-91d3d-default-rtdb.firebaseio.com",
    projectId: "fingerprint-91d3d",
    storageBucket: "fingerprint-91d3d.firebasestorage.app",
    messagingSenderId: "1039337845594",
    appId: "1:1039337845594:web:af66b6171c6ca5cd88b963",
    measurementId: "G-M5YGD0YBLZ"
};
// Firebase configuration
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Firebase connection status indicator
const connStatus = document.createElement('div');
connStatus.id = 'firebase-conn-status';
connStatus.style.position = 'fixed';
connStatus.style.bottom = '10px';
connStatus.style.right = '10px';
connStatus.style.padding = '8px 16px';
connStatus.style.background = '#222';
connStatus.style.color = '#fff';
connStatus.style.zIndex = 1000;
connStatus.style.borderRadius = '6px';
connStatus.innerText = 'Checking Firebase connection...';
document.body.appendChild(connStatus);

firebase.database().ref('.info/connected').on('value', function (snapshot) {
    if (snapshot.val() === true) {
        connStatus.innerText = 'Firebase Connected';
        connStatus.style.background = '#28a745';
    } else {
        connStatus.innerText = 'Firebase Disconnected';
        connStatus.style.background = '#dc3545';
    }
});

// Test write to Firebase for debugging
// Remove or comment this out after confirming it works
// database.ref('testWrite').set({test: true})
//     .then(() => console.log('Test write to Firebase succeeded!'))
//     .catch(err => console.error('Test write to Firebase failed:', err));

document.addEventListener('DOMContentLoaded', function () {
    let registrationID = null;

    // Handle Registration Form Submit
    document.getElementById('registrationForm').addEventListener('submit', async function (e) {
        e.preventDefault();

        const id = document.getElementById('id').value;
        const name = document.getElementById('name').value;
        const age = document.getElementById('age').value;
        const email = document.getElementById('email').value;

        registrationID = parseInt(id, 10);

        try {
            // Write the name to Firebase RTDB for ESP32 LCD
            await database.ref(`/users/${id}/name`).set(name);
            await database.ref().update({
                registerID: registrationID,
                registerMode: true
            });

            console.log("Registration mode activated for ID:", registrationID);
        } catch (error) {
            console.error("[Firebase Update Error] Could not start registration:", error);
            alert('Failed to start registration');
        }
    });

    // Global Listener for Firebase Updates
    const firebaseListener = database.ref().on('value', async (snapshot) => {
        const data = snapshot.val();

        if (data && data.success === true && registrationID !== null) {
            console.log("Fingerprint registered. Saving user to MongoDB...");

            const name = document.getElementById('name').value;
            const age = document.getElementById('age').value;
            const email = document.getElementById('email').value;

            try {
                const response = await fetch('/api/users/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: registrationID, name, age, email })
                });

                if (response.status === 201) {
                    alert('User registered successfully');
                    // Reset registration state
                    await database.ref().update({
                        registerMode: false,
                        success: false,
                        registerID: null
                    });
                    registrationID = null;
                } else if (response.status === 409) {
                    alert('User with this ID already exists!');
                    // Reset registration state on error too
                    await database.ref().update({
                        registerMode: false,
                        success: false,
                        registerID: null
                    });
                    registrationID = null;
                } else {
                    console.error("[MongoDB Error] Registration failed with status:", response.status);
                    alert('MongoDB registration failed');
                    // Reset registration state on error
                    await database.ref().update({
                        registerMode: false,
                        success: false,
                        registerID: null
                    });
                    registrationID = null;
                }
            } catch (error) {
                console.error('[MongoDB Exception] Error during registration:', error);
                alert('Failed to save to MongoDB');
                // Reset registration state on exception
                await database.ref().update({
                    registerMode: false,
                    success: false,
                    registerID: null
                });
                registrationID = null;
            }
        }

        if (data && data.value === true && data.id) {
            try {
                await database.ref().update({ value: false });
                await checkUser(data.id);
                fetchLogsForDate(new Date().toISOString().split('T')[0]);
            } catch (error) {
                console.error('[Attendance Error] Failed to mark attendance:', error);
                alert('Error processing attendance');
            }
        }
    });

    // Check Attendance
    async function checkUser(id) {
        try {
            const response = await fetch('/api/users/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });

            if (response.ok) {
                console.log("Attendance logged for ID:", id);
            } else if (response.status === 404) {
                console.warn('[Check User] User not found in MongoDB');
                alert('User not found.');
            } else {
                console.warn('[Check User] User inactive or unknown issue');
                alert('User not found or not active');
            }
        } catch (error) {
            console.error('[Check User Error] Could not process user check:', error.message);
            alert('Could not process attendance');
        }
    }

    // Handle Logs
    async function fetchLogsForDate(date) {
        console.log("Fetching logs for:", date);
        try {
            const response = await fetch(`/api/users/${date}`);
            console.log("Response status:", response.status);
            console.log("Response headers:", response.headers);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const logs = await response.json();
            console.log("Received logs:", logs);

            const container = document.getElementById('userLog');
            container.innerHTML = '';

            if (!logs.length) {
                container.innerHTML = '<p>No logs found for this date.</p>';
                return;
            }

            // Add header row
            const header = document.createElement('div');
            header.className = 'log-header';
            header.innerHTML = `
                <span class="log-name">Name</span>
                <span class="log-date">Date</span>
                <span class="log-time">Time</span>
            `;
            container.appendChild(header);

            // Reverse logs so newest are at the top
            logs.slice().reverse().forEach(log => {
                const name = log.name || '';
                let logDate = '';
                let logTime = '';
                if (log.timestamp) {
                    const dt = new Date(log.timestamp);
                    logDate = dt.toLocaleDateString();
                    logTime = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
                }
                const entry = document.createElement('div');
                entry.className = 'log-entry';
                entry.innerHTML = `
                    <span class="log-name">${name}</span>
                    <span class="log-date">${logDate}</span>
                    <span class="log-time">${logTime}</span>
                `;
                container.appendChild(entry);
            });
        } catch (error) {
            console.error('[Log Fetch Error] Could not load attendance logs:', error);
            console.error('Error details:', error.message);
            document.getElementById('userLog').innerHTML = `<p>Error loading logs: ${error.message}</p>`;
        }
    }

    document.getElementById('logDate').value = new Date().toISOString().split('T')[0];

    document.getElementById('logDate').addEventListener('change', function () {
        fetchLogsForDate(this.value);
    });

    fetchLogsForDate(document.getElementById('logDate').value);

    // --- Export to CSV modal logic ---
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const exportCsvModal = document.getElementById('exportCsvModal');
    const closeExportCsvModal = document.getElementById('closeExportCsvModal');
    const csvOptionButtons = document.getElementById('csvOptionButtons');
    const logsListOption = document.getElementById('logsListOption');
    const nsarListOption = document.getElementById('nsarListOption');
    const nsarFields = document.getElementById('nsarFields');
    const downloadNsarBtn = document.getElementById('downloadNsarBtn');
    const cancelNsarBtn = document.getElementById('cancelNsarBtn');
    // Add a result div for feedback
    let nsarResultDiv = document.getElementById('nsarResultDiv');
    if (!nsarResultDiv) {
        nsarResultDiv = document.createElement('div');
        nsarResultDiv.id = 'nsarResultDiv';
        nsarResultDiv.style.margin = '8px 0 0 0';
        nsarResultDiv.style.fontWeight = '500';
        nsarFields.insertBefore(nsarResultDiv, nsarFields.firstChild);
    }

    exportCsvBtn.addEventListener('click', function () {
        exportCsvModal.style.display = 'flex';
        csvOptionButtons.style.display = 'block';
        nsarFields.style.display = 'none';
        nsarResultDiv.textContent = '';
    });
    closeExportCsvModal.addEventListener('click', function () {
        exportCsvModal.style.display = 'none';
    });
    cancelNsarBtn.addEventListener('click', function () {
        exportCsvModal.style.display = 'none';
    });
    // Close modal on outside click
    window.addEventListener('click', function (event) {
        if (event.target === exportCsvModal) {
            exportCsvModal.style.display = 'none';
        }
    });
    // Logs List option
    logsListOption.addEventListener('click', async function () {
        console.log('Logs List clicked');
        csvOptionButtons.style.display = 'block';
        nsarFields.style.display = 'none';
        const date = document.getElementById('logDate').value;
        if (!date) {
            nsarResultDiv.style.color = '#c0392b';
            nsarResultDiv.textContent = 'Please select a date first.';
            return;
        }
        try {
            const response = await fetch(`/api/users/${date}`);
            const logs = await response.json();
            if (!logs.length) {
                nsarResultDiv.style.color = '#c0392b';
                nsarResultDiv.textContent = 'No logs found for this date.';
                return;
            }
            // Remove duplicate names (keep only the first occurrence)
            const seenNames = new Set();
            const uniqueLogs = [];
            for (const log of logs) {
                if (!seenNames.has(log.name)) {
                    seenNames.add(log.name);
                    uniqueLogs.push(log);
                }
            }
            if (!uniqueLogs.length) {
                nsarResultDiv.style.color = '#c0392b';
                nsarResultDiv.textContent = 'No logs found for this date.';
                return;
            }
            // Convert logs to CSV
            let csv = 'Name,ID,Timestamp\n';
            uniqueLogs.forEach(log => {
                const name = log.name || '';
                const id = log.id || '';
                const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleString() : '';
                csv += `"${name}","${id}","${timestamp}"\n`;
            });
            // Trigger download
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `user_logs_${date}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            exportCsvModal.style.display = 'none';
        } catch (error) {
            nsarResultDiv.style.color = '#c0392b';
            nsarResultDiv.textContent = 'Failed to export logs.';
            console.error('[CSV Export Error]', error);
        }
    });
    // NSAR List option
    nsarListOption.addEventListener('click', function () {
        console.log('NSAR List clicked');
        csvOptionButtons.style.display = 'none';
        nsarFields.style.display = 'flex';
        nsarResultDiv.textContent = '';
    });
    // Refactor NSAR form to use submit event
    nsarFields.addEventListener('submit', async function (e) {
        e.preventDefault();
        console.log('Download NSAR clicked');
        const fromDate = document.getElementById('nsarFromDate').value;
        const toDate = document.getElementById('nsarToDate').value;
        const course = document.getElementById('nsarCourse').value;
        if (!fromDate || !toDate || !course) {
            nsarResultDiv.style.color = '#c0392b';
            nsarResultDiv.textContent = 'Please fill all NSAR fields.';
            return;
        }
        try {
            const response = await fetch('/api/users/send-mail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fromDate, toDate, course })
            });
            
            console.log('Response status:', response.status);
            console.log('Response headers:', response.headers);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            console.log('Response result:', result);
            
            if (result.belowList && result.belowList.length > 0) {
                // Convert belowList to CSV
                let csv = 'Name,ID,Email,Classes Attended,Total Classes,Attendance (%)\n';
                result.belowList.forEach(s => {
                    csv += `"${s.name}","${s.id}","${s.email}","${s.attended}","${s.totalClasses}","${s.percent}"\n`;
                });
                // Trigger download
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `nsar_list_${fromDate}_to_${toDate}_${course}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                exportCsvModal.style.display = 'none';
            } else {
                nsarResultDiv.style.color = '#c0392b';
                nsarResultDiv.textContent = result.message || result.error || 'No students below 75% attendance.';
            }
        } catch (error) {
            nsarResultDiv.style.color = '#c0392b';
            nsarResultDiv.textContent = `Failed to export NSAR list: ${error.message}`;
            console.error('[NSAR Export Error]', error);
            console.error('Error details:', error.message);
        }
    });

    // --- Assign button functionality ---
    document.getElementById('assignBtn').addEventListener('click', async function () {
        const date = document.getElementById('logDate').value;
        const courseInput = document.getElementById('courseInput').value;
        const fromTime = document.getElementById('fromTime').value;
        const toTime = document.getElementById('toTime').value;
        
        if (!date) {
            alert('Please select a date first.');
            return;
        }
        if (!fromTime || !toTime) {
            alert('Please enter both From and To times.');
            return;
        }
        if (!courseInput.trim()) {
            alert('Please enter a course name.');
            return;
        }
        
        const confirmAssign = confirm(`Assign course "${courseInput}" to logs between ${fromTime} and ${toTime} on ${date}?`);
        if (!confirmAssign) return;
        
        try {
            const response = await fetch('/api/users/assign-course', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date, fromTime, toTime, course: courseInput })
            });
            const result = await response.json();
            if (response.ok) {
                alert(result.message || 'Course assigned successfully!');
            } else {
                alert(result.error || 'Failed to assign course.');
            }
        } catch (error) {
            alert('Failed to assign course.');
            console.error('[Assign Error]', error);
        }
    });

    // --- Send Mail button functionality ---
    const sendMailModal = document.getElementById('sendMailModal');
    const openSendMailBtn = document.getElementById('sendMailBtn');
    const closeSendMailModal = document.getElementById('closeSendMailModal');
    const cancelSendMail = document.getElementById('cancelSendMail');
    const sendMailForm = document.getElementById('sendMailForm');

    openSendMailBtn.addEventListener('click', function () {
        sendMailModal.style.display = 'flex';
    });
    closeSendMailModal.addEventListener('click', function () {
        sendMailModal.style.display = 'none';
    });
    cancelSendMail.addEventListener('click', function () {
        sendMailModal.style.display = 'none';
    });
    // Optional: close modal on outside click
    window.addEventListener('click', function (event) {
        if (event.target === sendMailModal) {
            sendMailModal.style.display = 'none';
        }
    });
    sendMailForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const fromDate = document.getElementById('mailFromDate').value;
        const toDate = document.getElementById('mailToDate').value;
        const course = document.getElementById('mailCourse').value;
        try {
            const response = await fetch('/api/users/send-mail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fromDate, toDate, course })
            });
            
            console.log('Send mail response status:', response.status);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            console.log('Send mail result:', result);
            
            if (result) {
                let msg = result.message || 'Mail sent!';
                if (result.belowList && result.belowList.length > 0) {
                    msg += '\n\nEmails sent to:';
                    msg += '\n' + result.belowList.map(s => `${s.name} <${s.email}> (${s.percent}%)`).join('\n');
                }
                alert(msg);
            } else {
                alert(result.error || 'Failed to send mail.');
            }
        } catch (error) {
            alert('Failed to send mail.');
            console.error('[Send Mail Error]', error);
        }
        sendMailModal.style.display = 'none';
    });

    // --- Go to Quiz button functionality ---
    const quizBtn = document.getElementById('quizBtn');
    if (quizBtn) {
        quizBtn.addEventListener('click', function () {
            window.open('https://feedback-system-three-dusky.vercel.app/', '_blank');
        });
    }
});