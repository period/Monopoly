const app = require("express")();
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
        rollDice(socket.gid);
    })
});

http.listen(1337, function() {
    console.log("WSS server started on 1337");
});

function rollDice(gameId, callback) {
    var counter = 10;
    var diceRoller = setInterval(() => {
        var diceA = Math.floor(Math.random() * 6) + 1;
        var diceB = Math.floor(Math.random() * 6) + 1;
        io.to(gameId).emit("dice", {a: diceA, b: diceB});
        counter--;
        if(counter == 0) {
            clearInterval(diceRoller);
            callback(diceA, diceB);
        }
    }, 100);
}