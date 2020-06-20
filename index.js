/** INITIALIZATION */

const { maxHeaderSize } = require('http');
const { Socket } = require('net');
const { time } = require('console');

var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

app.get('/', function(req, res){
  //res.sendFile(__dirname + '/client.js');
  res.sendFile(__dirname + '/index.html');
});


var Game_State = 0; // 0 - lobby, 1 - orders, 2 - executing
var CELLS_W = 50;
var CELLS_H = 50;
var cost_for_orthogonal = 10;
var cost_for_diagonal = 15;
var roundNb = 0;

var LOBBY = new Array();
var CHAR = new Array();
var MAP = -1;
var PATHS = -1;




/** MAIN SERVER */

io.on('connection', function(socket){
  //CONNECTION
  var name = "?";
  var key = Math.random();
  lobby_add_user(name, socket, 1, key, socket.id);

  //SEND KEY

  io.to(socket.id).emit("info_key", key);

  //DISCONNECT
  socket.on('disconnect', function(){
    lobby_disconnect_user(key)
  });

  //USER_READY
  socket.on("user_ready", function(){
    io.to(socket.id).emit("info_key", key); //(resend key just in case)
    lobby_ready_user(key);
    lobby_check_launch_game();
  });

  //NAME & COLOR
  socket.on('name', function(userName){
    name = userName;
    lobby_rename_user(key, userName);
  });
  socket.on("color", function(msg){
    lobby_update_color(key, msg);
  });

  /**Client sends info to log on server */
  socket.on('console_log', function(msg){
    console.log( "(" + name + ") : " + msg);
  });

  socket.on("order", function(msg){
    game_order_receive(msg, socket.id, key);
  });


  //io.to(socketId).emit

});

http.listen(3000, function(){
  console.log('listening on *:3000');
});




/********************************************************************************************* */
/*************************************** ROUND *********************************************** */
/********************************************************************************************* */

function round_init(){
  var maxStep = 150;
  var time_per_frame = 10;
  roundNb += 1;
  
  
  for (var i=0; i<CHAR.length; i++){
    //turn characters to new angle ?
    //reset movement
    CHAR[i].move_points = 0;
  }
  round_execute(0, maxStep, time_per_frame);
}

function round_execute(currentStep, maxStep, time_per_frame){
  console.log("round " + currentStep);

  round_execute_move();
  //if it allows people to move, then move
  //if char has ennemy in line of sight, then shoot
  //also reduce CD for weapons or reload if needed.
  //so move/wait for movement
  game_send_info();

  //launch next step
  if(currentStep >= maxStep) {
    round_end();
  } else {
    setTimeout(function(){
      round_execute(currentStep+1, maxStep, time_per_frame);
    }, time_per_frame);
  }
}

function round_execute_move(){
  for (var i=0; i<CHAR.length; i++){
    //add move points
    CHAR[i].move_points += 1;
    //console.log("character " + i + " has movepoints = " + CHAR[i].move_points);
    //move if possible
    if (PATHS[i].length > 0){
      if ((PATHS[i][0][0] == CHAR[i].x) || (PATHS[i][0][1] == CHAR[i].y)){
        //orthogonal move : 
        if (CHAR[i].move_points >= cost_for_orthogonal){
          CHAR[i].x = PATHS[i][0][0];
          CHAR[i].y = PATHS[i][0][1];
          CHAR[i].move_points -= cost_for_orthogonal;
          PATHS[i].splice(0, 1);
        }
      } else {
        //diagonal move : 
        if (CHAR[i].move_points >= cost_for_diagonal){
          CHAR[i].x = PATHS[i][0][0];
          CHAR[i].y = PATHS[i][0][1];
          CHAR[i].move_points -= cost_for_diagonal;
          PATHS[i].splice(0, 1);
        }
      }
    }
  }
}

function round_end(){
  //unready all
  for (var i=0; i<LOBBY.length; i++){
    LOBBY[i].ready = false;
  }
  Game_State = 1;

  lobby_update_text();
}



/********************************************************************************************* */
/*************************************** GAME ************************************************ */
/********************************************************************************************* */


function game_init(){
  roundNb = 0;
  //init map
  game_init_map();
  //init characters
  game_init_path();
  game_init_char();
  //send all : 
  game_send_info();
}

function game_send_info(){
  //send map to all :
  //io.emit("info_map", MAP);
  game_send_info_map();
  //send players individually
  io.emit("info_char", CHAR);
}

function game_send_info_map(){
  //for each player : 
  for (var i=0; i<LOBBY.length; i++){
    //calculate the fog
    game_getfog(LOBBY[i].key);
    //send them their version of the map
    io.to(LOBBY[i].id).emit("info_map", MAP);
  }
}

function game_getfog(_key){
  var radius = 20;
  var passiveRadius = 2;
  var angle = 180/360 * 2 * Math.PI;
  var raycasts = 150;
  var precisionRadius = 0.5;
  var currentAngle, currentX, currentY, currentMaxRadius;
  //fog all
  for (var i=0; i<CELLS_W; i++){
    for (var j=0; j<CELLS_H; j++){
      MAP[i][j].fog = 1;
    }
  }
  for (var i=0; i<CHAR.length; i++){
    if (CHAR[i].ownerKey == _key){
      //clear fog from this char
      for (var ray=0; ray<raycasts; ray++){
        currentAngle = ray/raycasts * 2*Math.PI;
        //if in line of sight
        if (util_is_inside(currentAngle, CHAR[i].direction-(0.5*angle), CHAR[i].direction+(0.5*angle))){
          currentMaxRadius = radius;
        } else {
          currentMaxRadius = passiveRadius;
        }
        for (var r=0; r<currentMaxRadius; r+=precisionRadius){
          currentX = Math.round(CHAR[i].x + r*Math.cos(currentAngle));
          currentY = Math.round(CHAR[i].y + r*Math.sin(currentAngle));
          if (util_is_inside(currentX, 0, CELLS_W)){
            if (util_is_inside(currentY, 0, CELLS_H)){
              MAP[currentX][currentY].fog = 0;
              //block if wall
              if (MAP[currentX][currentY].impassable == 1){
                r = currentMaxRadius;
              }
            }
          }
        }
      }
    } //endif CHAR
  }
}

function game_init_path(){
  PATHS = new Array(2*lobby_count_active());
  for (var i=0; i<PATHS.length; i++){
    PATHS[i] = [];
  }
}

function game_init_char(){
  var players = lobby_count_active();
  CHAR = new Array(2*players);
  for (var i=0; i<CHAR.length; i++){
    var playernb = Math.floor(i/2);
    var team_x = Math.round((CELLS_W/2) + ( (CELLS_W-4) * 0.5 * Math.cos(playernb * (Math.PI*2 / players)) ));
    var team_y = Math.round((CELLS_H/2) + ( (CELLS_H-4) * 0.5 * Math.sin(playernb * (Math.PI*2 / players)) ));
    CHAR[i] = new Object();
    CHAR[i] = {PV:100, PV_max:100, move_points:0, direction:0, x:team_x - 1 + (2*(i%2)), y:team_y, ownerKey:LOBBY[playernb].key};
    CHAR[i].color = LOBBY[playernb].color

    //CLEAR SPAWNS
    var clearRange = 4;
    for (var x=-clearRange; x<=clearRange; x++){
      for (var y=-clearRange; y<=clearRange; y++){
        if (util_is_inside(team_x+x, -1, CELLS_W) & (util_is_inside(team_y+y, -1, CELLS_H))){
          MAP[team_x+x][team_y+y].impassable = 0;
        }
      }
    }
  }
}



function game_init_map(){
  MAP = new Array(CELLS_W);
  for (var i=0; i<MAP.length; i++){
    MAP[i] = new Array(CELLS_H);
    for (var j=0; j<MAP[i].length; j++){
      MAP[i][j] = new Object();
      MAP[i][j] = {impassable:0, fog:0};
    }
  }
  game_init_map_random();
}

function game_init_map_random(){
  //add random obstacles
  var nbplayers = lobby_count_active();
  var random_iterations = 0;
  var random_fill_threshhold = 0.25;
  //3 barriers
  for (var i=0; i<nbplayers; i++){
    var barrier_x = Math.round((CELLS_W/2) + ( (CELLS_W) * 0.3 * Math.cos((i+0.5) * (Math.PI*2 / nbplayers)) ));
    var barrier_y = Math.round((CELLS_H/2) + ( (CELLS_H) * 0.3 * Math.sin((i+0.5) * (Math.PI*2 / nbplayers)) ));
    game_init_map_random_obstacle(barrier_x, barrier_y, 6, 2);
  }
  //random until percentage filled
  while (game_init_map_fillpercent() < random_fill_threshhold){
    game_init_map_random_obstacle(Math.floor(Math.random()*CELLS_W), Math.floor(Math.random()*CELLS_H), 20, 3);
  }
  //random stuff
  for (var i=0; i<random_iterations; i++){
    game_init_map_random_obstacle(Math.floor(Math.random()*CELLS_W), Math.floor(Math.random()*CELLS_H), 10, 2);
  }
  //remove diagonals
  game_init_map_remove_diagonals(0.5);
}

function game_init_map_remove_diagonals(fillproba=0.5){
  var pattern_found;
  var patterns_changed = 0;
  var done;
  while (!done) {
    done = true;  
    for (var i=0; i<CELLS_W-1; i++){
      for (var j=0; j<CELLS_H-1; j++){
        pattern_found = false;
        //apply mask to find pattern
        if (MAP[i][j].impassable == 1 & MAP[i+1][j+1].impassable == 1){
          if (MAP[i+1][j].impassable == 0 & MAP[i][j+1].impassable == 0){
            pattern_found = true;
          }
        }
        if (MAP[i][j].impassable == 0 & MAP[i+1][j+1].impassable == 0){
          if (MAP[i+1][j].impassable == 1 & MAP[i][j+1].impassable == 1){
            pattern_found = true;
          }
        }
        //if pattern -> rectify by deleting a block or adding one
        if (pattern_found){
          done = false;
          if (Math.random()<fillproba){
            //fill :
            if (MAP[i][j].impassable){
              MAP[i][j+1].impassable = 1;
            } else {
              MAP[i][j].impassable = 1;
            }
          } else {
            //empty
            if (MAP[i][j].impassable){
              MAP[i][j].impassable = 0;
            } else {
              MAP[i][j+1].impassable = 1;
            }
          }
          patterns_changed +=1;
        }
      }
    }
  }
  console.log("Patterns changed : " + patterns_changed);
}

function game_init_map_random_obstacle(x, y, size=5, iterations=1){
  MAP[x][y].impassable = 1;
  for (var i=0; i<iterations; i++){
    for(var j=0; j<size; j++){
      x += -1 + Math.round(Math.random()*2);
      y += -1 + Math.round(Math.random()*2);
      if (util_is_inside(x, -1, CELLS_W)){
        if (util_is_inside(y, -1, CELLS_H)){
          MAP[x][y].impassable = 1;
        }
      }
    }
  }
}

function game_init_map_fillpercent(){
  var total = 0;
  var filled = 0;
  for (var i=0; i<CELLS_W; i++){
    for(var j=0; j<CELLS_H; j++){
      total += 1;
      if (MAP[i][j].impassable) filled += 1;
    }
  }
  return (filled/total);
}

function game_get_char_index(key, char_index){
  var counter = char_index;
  for (var i=0; i<CHAR.length; i++){
    if (key == CHAR[i].ownerKey){
      if (counter == 0){
        return i;
      } else {
        counter -= 1;
      }
    }
  }
  console.log("_DID NOT FIND CHAR INDEX");
}

function game_order_receive(orderObject, socketId, _key){
  if (Game_State == 1) {
    var path = game_pathfind(orderObject);
    io.to(socketId).emit("order_pathfind", path);
    
    //retrieve character and store path
    var index = game_get_char_index(_key, orderObject.char_index);
    PATHS[index] = [];
    PATHS[index] = path;
    //io.emit("console_broadcast", PATHS);
  }
}

function game_pathfind(orderObject){
  console.log("Pathfinding...")
  var start = [orderObject.x1, orderObject.y1];
  var end = [orderObject.x2, orderObject.y2];
  var done = false;
  var visit_index = 0;
  var end_index;
  var origin = [start];
  var visit = [start];
  var cost = [0];
  var count_visited_cells = 0;

  //safety for start or end in impassable : 
  if ((MAP[start[0]][start[1]].impassable) || (MAP[end[0]][end[1]].impassable)){
    console.log("Abort Search (in wall)");
    return [];
  }
  
  while (!done){
    count_visited_cells ++;
    var x_current = visit[visit_index][0];
    var y_current = visit[visit_index][1];
    //console.log("visiting ("+x_current+", "+y_current+")");

    //check 9 neighbors :
    for (var x=-1; x<2; x++){
      for (var y=-1; y<2; y++){
        if (util_is_inside(x_current+x, -1, CELLS_W)){
          if (util_is_inside(y_current+y, -1, CELLS_H)){
            //if passable
            if (!(MAP[x_current+x][y_current+y].impassable)){
              var neighbor = [x_current+x, y_current+y];
              var diago = ((Math.abs(x) == 1) & (Math.abs(y) == 1));
              game_pathfind_neighbor(neighbor, visit_index, origin, visit, cost, diago);
            }
          }
        }
      }
    }

    if(x_current == end[0] & y_current == end[1]){
      done = true;
      end_index = visit_index;
    } else if (visit_index == visit.length-1){
      done = true;
      end_index = -1;
    } else {
      visit_index += 1;
    }
  }

  console.log("Rebuilding...");
  //then, rebuild path
  done = false;
  var impossible;
  var currentIndex = 1;
  var Path = [end];
  while(!done & !impossible){
    var impossible = true;
    for (var i=0; i<visit.length; i++){
      if ((visit[i][0] == Path[currentIndex-1][0]) & (visit[i][1] == Path[currentIndex-1][1])){
        impossible = false;
        Path[currentIndex] = origin[i];
        currentIndex += 1;
        if ((start[0] == Path[currentIndex-1][0]) & (start[1] == Path[currentIndex-1][1])){
          done = true;
          break;
        }
      }
    }
  }

  Path.reverse();
  //io.emit("console_broadcast", Path);  
  console.log("...Done ! (visited " + count_visited_cells + " cells.)");
  if (impossible) console.log("Impossible !");
  return Path;
}

function game_pathfind_neighbor(neighbor, visit_index, origin, visit, cost, diago){
  //init new values for neighbor
  var newOrigin = visit[visit_index];
  var newVisit = neighbor;
  var newCost = cost[visit_index];
  newCost += ((diago)?cost_for_diagonal:cost_for_orthogonal);
  //check if already here
  for (var i=0; i<visit.length; i++){
    if ((newVisit[0] == visit[i][0]) & (newVisit[1] == visit[i][1])){
      //-> compare costs
      if (newCost < cost[i]){
        //splice and delay index
        //console.log("splicing point : (" + visit[i] + ") from ("+origin[i]+") - cost "+cost[i]+" -> better path through (" + newOrigin + ")");
        visit.splice(i, 1);
        cost.splice(i, 1);
        origin.splice(i, 1);
        visit_index -= 1;
      } else {
        //cancel this neighbor, not worthy
        return;
      }
    }
  }
  //add to lists
  var index = visit.length;
  //console.log("adding visit : (" + newVisit + ") - cost " + newCost);
  visit[index] = newVisit;
  origin[index] = newOrigin;
  cost[index] = newCost;
}


/********************************************************************************************* */
/*************************************** LOBBY *********************************************** */
/********************************************************************************************* */

function lobby_check_launch_game(){
  var start = 1;
  for (var i=0; i<LOBBY.length; i++){
    if (LOBBY[i].status){
      if (LOBBY[i].ready == false){
        start = 0;
      }
    }
  }
  if (start & (Game_State == 0)){
    console.log("___Game Start !");
    Game_State = 1;
    for (var i=0; i<LOBBY.length; i++){ LOBBY[i].ready = false; }
    game_init();
    io.emit("game_start");
  } else if (start & (Game_State == 1)){
    console.log("___Round Start !");
    Game_State = 2;
    round_init();
    io.emit("round_start", );
  }
  lobby_update_text();
}

function lobby_ready_user(_key){
  var index = lobby_get_index(_key);
  LOBBY[index].ready = true;
  console.log("__Ready - " + LOBBY[index].name);
  lobby_update_text();
}

function lobby_add_user(_name, _socket, _status, _key, _id){
  var index = LOBBY.length;
  LOBBY[index] = new Object();
  LOBBY[index] = {name:_name, socket:_socket, status:_status, key:_key, ready:false, color:util_random_color(), id:_id};
  console.log("__Connect - " + _name);
  lobby_update_text();
}

function lobby_disconnect_user(_key){
  var index = lobby_get_index(_key);
  LOBBY[index].status = 0;
  console.log("__Disconnect - " + LOBBY[index].name);
  LOBBY.splice(index, 1);
  //print(LOBBY);
  lobby_update_text();
}

function lobby_rename_user(_key, newName){
  var index = lobby_get_index(_key);
  LOBBY[index].name = newName;
  console.log("__Rename - " + LOBBY[index].name);
  lobby_update_text();
}

function lobby_update_color(_key, _color){
  var index = lobby_get_index(_key);
  LOBBY[index].color = _color;
  lobby_update_text();
}

function lobby_update_text(){
  var text = "";
  for (var i=0; i<LOBBY.length; i++){
    if(LOBBY[i].status == 1){
      text += "<font color=\"" + LOBBY[i].color + "\" >";
      text += LOBBY[i].name; //+ " (status : " + (LOBBY[i].status == 1 ? "connected":"away") + ")";
      if(Game_State == 0){
        text += " - " + (LOBBY[i].ready ? "pret":"pas pret") + " !";
      } else {
        text += " - " + (LOBBY[i].ready ? "a fini son tour":"reflechit") + ".";
      }
      text += "</font><br>";
    }
  }
  //console.log(text);
  io.emit("lobby_text", text);
}

function lobby_get_index(key){
  for (var i=0; i<LOBBY.length; i++){
    if(LOBBY[i].key == key){
      return i;
    }
  }
  return undefined;
}

function lobby_count_active(){
  var res = 0;
  for (var i=0; i<LOBBY.length; i++){
    if(LOBBY[i].status == 1){
      res += 1;
    }
  }
  return res;
}



/********************************************************************************************* */
/*************************************** UTILS *********************************************** */
/********************************************************************************************* */

function util_random_color(){
  var r = Math.random()*255;
  var g = Math.random()*255;
  var b = Math.random()*255;
  return "rgb("+r+","+g+","+b+")";
}

function util_is_inside(a, b1, b2){
  return ((a < b2) & (a > b1));
}