'use strict';

var express = require('express');
var mongo = require('mongodb');
var mongoose = require('mongoose');
var bodyParser = require('body-parser');
var cors = require('cors');
const dns = require('dns');
const url = require('url');
var app = express();
var sha256 = require('js-sha256');
var BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
var base62 = require('base-x')(BASE62);


/** Basic Configuration **/
var port = process.env.PORT || 3000;

/** Connect to DB **/ 
try{
  mongoose.connect(process.env.MONGOLAB_URI,{useNewUrlParser: true} );
}
catch(error){
  console.log("Error in connecting");
}

app.use(cors());

/** body-parser **/
app.use(bodyParser.urlencoded({extended: false}));

app.use('/public', express.static(process.cwd() + '/public'));

/** Home page **/
app.get('/', function(req, res){
  res.sendFile(process.cwd() + '/views/index.html');
});


/** Your first API endpoint for testing ... **/
app.get("/api/hello", function (req, res) {
  res.json({greeting: 'hello API'});
});

/** Create Schema for URL **/
var Schema = mongoose.Schema;
var urlSchema = new Schema({
    originalUrl:{
      type: String,
      required: true
    },
    shortUrl:{
      type: String
    }
}); 

/** Create mongoose Model from Schema **/
var Url = mongoose.model('Url',urlSchema);

//Function to check if the user has provided a valid URL for shortening
var checkIfValidUrl= function(origUrl){
  var parsedUrl = url.parse(origUrl);       //Parse the URL
  //perform DNS lookup to check the original URL actually exist
  var dnsLookupResult = dns.lookup(parsedUrl.host,function(err, hostname, service){  
    if(err){
      console.log(err);
      return false;
    }
    return true;
  }); 
  //If URL uses HTTPS protocol, hash slashes and DNS lookup for it is successful, return true else false;
  return (parsedUrl.protocol === 'https:' &&  parsedUrl.slashes === true &&  dnsLookupResult); 
}

/** Calculate Short URL for the given Original URL **/
let calculateShortUrl = function(origUrl,startInd=0){
  var hash = sha256(origUrl);                                                                  //calculate hash value from original URL
  var buf = Buffer.from(hash);                            //create a buffer of hex characters present in var hash for the use of base-x
  var shortUrl = base62.encode(buf).substr(0,6);  //perform Base 62 encoding of the hashvalue and take six characters from encoded string as shortURL
  return shortUrl;
}

/** Function to save URL in DB when original URL and short URL are given **/
let saveShortUrl = function(origUrl,shortnedUrl){
  var newUrl = new Url({originalUrl: origUrl,shortUrl: shortnedUrl});
  newUrl.save(function(err,data){
    if(err){
      console.log(err);
    }
  });
}

/** To find if the calculated short URL is already alloted to some other Original URL in DB or not? **/
let isShortUrlExist = function(shortUrl){
  Url.findOne({shortUrl: shortUrl},function(err,data){
    if(err){
      return false;
    }
    if(data === null){
      return false;
    }
    return true;
  });
}

/* Find URL based on Original URL and Short URL */
let findUrl = function(origUrl,shortUrl){
  Url.findOne({originalUrl:origUrl,shortUrl: shortUrl},function(err,data){
    if(err){
      console.log(err);
    }
    return data
  });
}

/** Create a Short URL for a valid user given URL 
    Function returns true if URL is already present in DB or on successful creation of short URL.
    Otherwise, returns false.
**/
var createShortUrl = function(origUrl){
  
  return Url.findOne({originalUrl: origUrl},function(err,data){    //Check if db already has a short URL for the given Original URL
    if(err){                                                                                               //If Error, return false
      return false;
    }
    else if(data === null){               //If DB does not have short URL for given Original URL, then create one and save it in DB. 
      let shortnedUrl = "";
                         //If the calculated short URL is alreay present in the db, then try one more time to create a new short URL.
      for(let i=0;i<2;i++){
        let shortnedUrl = calculateShortUrl(origUrl,i);                                                        //Calculate Short URL
        if(!isShortUrlExist(shortnedUrl)){                          //If calculated URL is not present in DB,save it and return true
          saveShortUrl(origUrl,shortnedUrl);
          return true;
        }
      }
      /* If two attempts fail to create a unique short link that is not present in DB, get the document with the shortname
       and update it's original URL with the user given URL and return true */
      Url.findOneAndUpdate({shortUrl: shortnedUrl},{originalUrl: origUrl},{returnNewDocument: true},function(err,data){
       if(err){
          return false;
       }
        return true;
      });
    }
    else{                                                    //If db already has a short URL for the given Original URL, return true
      return true;
    }
  });  
}

/** POST API to create short URL for user given URL **/
app.post("/api/shorturl/new",function(req,res){
  var origUrl = req.body.url; //Get user given URL from POST request
  var parsedUrl = url.parse(origUrl);  //Parse the URL
  if(parsedUrl.protocol === 'https:' &&  parsedUrl.slashes === true){  //Check if the URL uses http protocol and has slashes or not
    dns.lookup(parsedUrl.host,function(err, hostname, service){
      if(err){  //If dns lookup fails
        res.json({"error":"invalid URL"});
      }
      else{             //If dns lookup passes   
        let result = createShortUrl(origUrl); //Get URL creation result
        setTimeout(function(){       //Wait for 100 ms for DB to get updated before sending JSON object 
          if(result){
            Url.findOne({originalUrl: origUrl},function(err,foundUrl){
              if(err){
                console.log("short url was not created.");
              }
              res.json({original_url: foundUrl.originalUrl,short_url: foundUrl.shortUrl});
            });
          }
          else{    //If origUrl is not found in DB,send error in response
            res.json({error: "short url was not created."});
          }
        }, 100);
      }
    });
  }
  else{  //if the URL does not use http protocol and has slashes or not
    res.json({"error":"invalid URL"});
  }
});

/** Function to redirect GET requests with Short URL to actual URL **/
app.get('/api/shorturl/:shortUrl',function(req,res){
  let shortUrl = req.params.shortUrl;                                                                               //Get the short URL
  Url.findOne({shortUrl: shortUrl},function(err,data){                                             //Find it's corresponding actual URL
    if(err){                                                                                   //If Error occurs,send error in response                                                                                  
      res.json({error: err});
    }
    else if(data === null){                                                     //If not found in DB, return 404 (Page not found reponse)
      res.status(404).send(`Short URL ${shortUrl} does not exist in DB`);
    }
    else{                                                                                   //If found in DB, redirect to original link
      res.redirect(data.originalUrl);  
    }
  });
});

/** Start server **/
app.listen(port, function () {
  console.log('Node.js listening ...');
});