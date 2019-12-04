const express = require("express");
const app = express();
const http = require("http").Server(app);
const fs = require("fs");
const io = require("socket.io")(http);

var games = {};

app.get("/", function(req, res) {
    res.header("Content-Type", "text/html");
    res.send(fs.readFileSync("index.html"));
})
app.get("/board", function(req, res) {
    res.header("Content-Type", "text/html");
    res.send(fs.readFileSync("board.html"));
})
app.use(express.static("public"));

app.get("/create-game", function(req, res) {
    res.header("Content-Type", "text/html");

})

io.on("connection", function(socket) {
    socket.on("join-room", function(data) {
        data = data.toString();
        //if(games[data] == null) return socket.emit("eval", "window.location.href = \"./\"");
        socket.gid = data;
        socket.join(data);
        socket.emit("message", {type: "success", message: "Successfully joined game"});
    })
    socket.on("roll-dice", function() {
        rollDice(socket.gid, function() {
            
        });
    })
});

http.listen(1337, function() {
    console.log("WSS server started on 1337");
});

function rollDice(gameId, callback) {
    var counter = 10;
    io.to(gameId).emit("dice-start");
    var diceRoller = setInterval(() => {
        var diceA = Math.floor(Math.random() * 6) + 1;
        var diceB = Math.floor(Math.random() * 6) + 1;
        io.to(gameId).emit("dice", {a: diceA, b: diceB});
        counter--;
        if(counter == 0) {
            io.to(gameId).emit("dice-stop");
            clearInterval(diceRoller);
            setTimeout(function() {
                callback(diceA, diceB);
            }, 1500); // there's a delay on the client end to allow user to see the result. we'll delay the callback the same amount to stop the game progressing too much
        }
    }, 100);
}