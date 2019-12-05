const express = require("express");
const app = express();
const http = require("http").Server(app);
const fs = require("fs");
const io = require("socket.io")(http);

var games = {};

app.get("/", function (req, res) {
    res.header("Content-Type", "text/html");
    res.send(fs.readFileSync("index.html"));
})
app.get("/board", function (req, res) {
    res.header("Content-Type", "text/html");
    res.send(fs.readFileSync("board.html"));
})
app.use(express.static("public"));

games["test"] = JSON.parse(fs.readFileSync("base-game.json"));

app.get("/create-game", function (req, res) {
    var gameId = Math.random().toString(36).substring(8); // game ids are random 4char strings
    games[gameId] = JSON.parse(fs.readFileSync("base-game.json"));
    res.header("Content-Type", "application/json");
    res.send(JSON.stringify({ game: gameId }));

})

io.on("connection", function (socket) {
    socket.on("join-room", function (data) {
        data = data.toString();
        if (games[data] == null) return socket.emit("eval", "window.location.href = \"./\"");
        socket.gid = data;
        socket.join(data);
        socket.emit("message", { type: "success", message: "Successfully joined game (" + io.sockets.adapter.rooms[data].length + " in room)" });
        if (games[data].state == "Lobby" && io.sockets.adapter.rooms[data].length == 2) {
            var countdown = 3;
            games[data].state = "Starting";
            var countdownTimer = setInterval(() => {
                io.to(data).emit("countdown", countdown);
                countdown--;
                if (countdown == -1) {
                    clearInterval(countdownTimer);
                    if (io.sockets.adapter.rooms[data].length < 1) {
                        io.to(data).emit("message", { type: "warning", message: "Not enough players... (" + io.sockets.adapter.rooms[data].length + " in room)" });
                        countdown = 15;
                        games[data].state = "Lobby";
                    }
                    else {
                        io.to(data).emit("message", { type: "success", message: "Game has started! (" + io.sockets.adapter.rooms[data].length + " in room)" });
                        games[data].state = "Ingame";
                        for (var sock of getSocketsInGame(data)) {
                            var selectedPiece = games[data]["available-positions"].pop();
                            sock.emit("piece-selected", selectedPiece);
                            sock.piece = selectedPiece;
                            sock.balance = 1500;
                            games[data].players.push(sock);
                        }
                        nextRound(data);
                    }
                }
            }, 1000);
        }
    })
    socket.on("roll-dice", function () {
        rollDice(socket.gid, function () {

        });
    })
});

http.listen(1337, function () {
    console.log("WSS server started on 1337");
});

function getSocketsInGame(gameId) {
    var sockets = [];
    for (var clientId in io.sockets.clients().sockets) {
        if (io.of("/").connected[clientId].gid == gameId) sockets.push(io.of("/").connected[clientId]);
    }
    return sockets;
}

function rollDice(gameId, callback) {
    var counter = 10;
    io.to(gameId).emit("dice-start");
    var diceRoller = setInterval(() => {
        var diceA = Math.floor(Math.random() * 6) + 1;
        var diceB = Math.floor(Math.random() * 6) + 1;
        io.to(gameId).emit("dice", { a: diceA, b: diceB });
        counter--;
        if (counter == 0) {
            io.to(gameId).emit("dice-stop");
            clearInterval(diceRoller);
            setTimeout(function () {
                callback(diceA, diceB, (diceA + diceB));
            }, 1500); // there's a delay on the client end to allow user to see the result. we'll delay the callback the same amount to stop the game progressing
        }
    }, 100);
}

function nextRound(gameId) {
    if (games[gameId] == null) return;
    if (games[gameId].players.length <= 1) return gameOver(gameId); // no players OR just one player remaining
        // First step is to find the next player!
        var currentPlayer = null;
        for (var i = 0; i < games[gameId].players.length; i++) {
            if (games[gameId]["has-played-round"].includes(games[gameId].players[i].piece) == false) {
                currentPlayer = games[gameId].players[i];
                games[gameId]["has-played-round"].push(games[gameId].players[i].piece);
                break;
            }
        }
        if (currentPlayer == null) { // No player found - maybe we filled the array. Clear it, retry.
            games[gameId]["has-played-round"] = [];
            return nextRound(gameId);
        }
        io.to(gameId).emit("message", { type: "info", message: "It's now " + currentPlayer.piece + "'s turn!" });

        rollDice(gameId, function (diceA, diceB, sum) {
            io.to(gameId).emit("message", { type: "info", message: currentPlayer.piece + " rolled <strong>" + sum + "</strong>." });

            nextRound(gameId);
        })
}
function gameOver(gameId) {
    io.to(gameId).emit("game-over");
    setTimeout(function () {
        io.to(gameId).emit("eval", "window.location.href = \"./\"");
        games[gameId] = null;
    }, 15000);
}