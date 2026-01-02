const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path'); // für absolute Pfade

const app = express();
const PORT = 3001;

// Statische Dateien ausliefern
app.use(express.static(path.join(__dirname, 'public')));

// Optional: Root-Route auf index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// HTTP-Server erstellen
const server = http.createServer(app);

// Socket.io einrichten
const io = new Server(server, {
    cors: { origin: "*" }
});

io.on('connection', (socket) => {
    console.log('Neue WebSocket-Verbindung:', socket.id);
    socket.on('message', (data) => {
        console.log('Nachricht vom Client:', data);
        io.emit('message', `Server hat empfangen: ${data}`);
    });
    socket.on('disconnect', () => {
        console.log('Client getrennt:', socket.id);
    });
});

// Server starten
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is listening at http://0.0.0.0:${PORT}`);
});
