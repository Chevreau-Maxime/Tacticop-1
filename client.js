var can = document.getElementById("canvas");
var con = can.getContext('2d');


function map_clear(){
    con.fillStyle = "blue";
    con.fillRect(0, 0, can.width, can.height);
}