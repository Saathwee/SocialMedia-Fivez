var express = require("express");
var app = express();

var formidable = require("express-formidable");
app.use(formidable({
    multiples: true, // request.files to be arrays of files
}));

var mongodb = require("mongodb");
var mongoClient = mongodb.MongoClient;
var ObjectId = mongodb.ObjectId;

var http = require("http").createServer(app);
var bcrypt = require("bcryptjs")
var fileSystem = require("fs");

var nodemailer = require("nodemailer");
var requestModule = require('request');

var functions = require("./modules/functions");
var page = require("./modules/page");
var group = require("./modules/group");
var addPost = require("./modules/add-post");
var editPost = require("./modules/edit-post");

var jwt = require("jsonwebtoken");
var accessTokenSecret = "myAccessTokenSecret1234567890";

const Cryptr = require("cryptr");
global.cryptr = new Cryptr("mySecretKey");

const Filter = require("bad-words");
const filter = new Filter();

const cron = require("node-cron");
const moment = require('moment-timezone')

app.use("/voice-notes", express.static(__dirname + "/voice-notes"))
app.use("/public", express.static(__dirname + "/public"))
app.use("/uploads", express.static(__dirname + "/uploads"))
app.use("/audios", express.static(__dirname + "/audios"))
app.use("/documents", express.static(__dirname + "/documents"))
app.set("view engine", "ejs")

var socketIO = require("socket.io")(http, {
    cors: {
        origin: "*"
    }
});
var socketID = "";
var users = [];

// Add headers before the routes are defined
app.use(function (req, res, next) {
 
    // Website you wish to allow to connect
    res.setHeader("Access-Control-Allow-Origin", "*")
 
    // Request methods you wish to allow
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE")
 
    // Request headers you wish to allow
    res.setHeader("Access-Control-Allow-Headers", "X-Requested-With,content-type,Authorization")
 
    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader("Access-Control-Allow-Credentials", true)
 
    // Pass to next layer of middleware
    next()
})

const port = process.env.PORT || 4000
global.mainURL = "http://localhost:" + port;

//var nodemailerFrom = "support@adnan-tech.com";
var nodemailerFrom = " ";
var nodemailerObject = {
	host: '',
    port: 465,
    secure: true,
	auth: {
		user: "",
		pass: ""
	}
};

socketIO.on("connection", function (socket) {
	// console.log("User connected", socket.id)
	socketID = socket.id
})

function getUTCToTZInFormat(eventDateTimeUTC) {
	const userTZEventDate = eventDateTimeUTC.split("T").join(" ").slice(0, -1)
	let date = moment.utc(userTZEventDate).tz(moment.tz.guess()).format()
	date = date.split("+")[0]
	return date
}

const Stripe = require('stripe')
// const stripe = Stripe('')
// const stripePublicKey = ""

http.listen(port, function () {
	console.log("Server started at " + mainURL);

	mongoClient.connect("mongodb://localhost:27017", {
		useUnifiedTopology: true
	}, async function (error, client) {
		global.database = client.db("my_social_network");
		console.log("Database connected.");

		functions.database = database;
		functions.fileSystem = fileSystem;

		page.database = database;
		page.ObjectId = ObjectId;
		page.fileSystem = fileSystem;

		group.database = database;
		group.ObjectId = ObjectId;
		group.fileSystem = fileSystem;

		addPost.database = database;
		addPost.functions = functions;
		addPost.fileSystem = fileSystem;
		addPost.requestModule = requestModule;
		addPost.filter = filter;
		addPost.ObjectId = ObjectId;
		addPost.mainURL = mainURL;

		editPost.database = database;
		editPost.functions = functions;
		editPost.fileSystem = fileSystem;
		editPost.requestModule = requestModule;
		editPost.filter = filter;
		editPost.ObjectId = ObjectId;

		cron.schedule("* * * * *", async function () {
			let stories = await database.collection("stories").aggregate([{
				$project: {
					duration: {
						$divide: [{
							$subtract: [new Date().getTime(), "$createdAt"]
						}, 3600000]
					}
				}
			}]).toArray()
			let filterArr = []
			for (let a = 0; a < stories.length; a++) {
				if (stories[a].duration >= 24) {
					filterArr.push(stories[a]._id)
				}
			}

			await database.collection("stories").updateMany({
				"_id": {
					$in: filterArr
				}
			}, {
				$set: {
					"status": "passed"
				}
			})
			// console.log("---------------------")
			// console.log("Stories ended........")
			// console.log(filterArr)
			// console.log("---------------------")

			const currentTimestamp = new Date().getTime()
			
			const advertisements = await database.collection("advertisements").find({
				$and: [{
					endAt: {
						$lt: currentTimestamp
					}
				}, {
					status: "active"
				}]
			}).toArray()

			const updatedAds = []

			for (let a = 0; a < advertisements.length; a++) {
				await database.collection("advertisements").findOneAndUpdate({
					_id: advertisements[a]._id
				}, {
					$set: {
						status: "inactive"
					}
				})

				await database.collection("posts").findOneAndUpdate({
					_id: advertisements[a].post._id
				}, {
					isBoost: false
				})

				updatedAds.push(advertisements[a]._id)
			}

			// console.log({
			// 	updatedAds: updatedAds
			// })
		})

		app.post("/deleteAccount", async function (request, result) {
			const accessToken = request.fields.accessToken
			const password = request.fields.password

			if (!password) {
				result.json({
					status: "error",
					message: "Password is required for account deletion."
				})

				return
			}

			const user = await database.collection("users").findOne({
				accessToken: accessToken
			})

			if (user == null) {
				result.json({
					status: "error",
					message: "User not found."
				})

				return
			}

			bcrypt.compare(password, user.password, async function (error, res) {
				if (res === true) {

					// get profile image and cover photo
					// delete them
					if (user.profileImage != "") {
						await fileSystem.unlinkSync(user.profileImage)
					}

					if (user.coverPhoto != "") {
						await fileSystem.unlinkSync(user.coverPhoto)
					}

					// delete from posts collection
					await database.collection("posts").deleteMany({
						"user._id": user._id
					})

					// delete pages
					await database.collection("pages").deleteMany({
						"user._id": user._id
					})

					// delete groups
					await database.collection("groups").deleteMany({
						"user._id": user._id
					})

					// delete from other user friends array
					await database.collection("users").updateMany({
						"friends._id": user._id
					}, {
						$pull: {
							"friends": {
								"_id": user._id
							}
						}
					})

					// delete from users collection
					await database.collection("users").deleteOne({
						_id: user._id
					})

					result.json({
						status: "success",
						message: "Account has been deleted."
					})

					return
				} else {
					result.json({
						status: "error",
						message: "Password is in-correct."
					})

					return
				}
			})
		})

		app.route("/joinGroupChatViaQRCode")
			.get(function (request, result) {
				result.render("joinGroupChatViaQRCode", {
					_id: request.query._id
				})
			})
			.post(async function (request, result) {
				const accessToken = request.fields.accessToken
		        const _id = request.fields._id

		        const userObj = await database.collection("users").findOne({
		            accessToken: accessToken
		        })

		        if (userObj == null) {
		            result.json({
		                status: "error",
		                message: "User has been logged out. Please login again."
		            })

		            return
		        }

		        if (userObj.isBanned) {
					result.json({
						status: "error",
						message: "You have been banned."
					})

					return
				}

				const group = await database.collection("groupChats").findOne({
					_id: ObjectId(_id)
			    })

			    if (group == null) {
					result.json({
						status: "error",
						message: "Group not found."
					})

					return
				}

				for (let a = 0; a < group.members.length; a++) {
					if (group.members[a].user._id.toString() == userObj._id.toString()) {
						result.json({
							status: "error",
							message: "You are already a member of this group."
						})

						return
					}
				}

				const obj = {
					_id: ObjectId(),
					status: "Accepted",
	    			user: {
	    				_id: userObj._id,
	    				name: userObj.name
	    			},
	    			invitedBy: {
	    				_id: userObj._id,
	    				name: userObj.name
	    			},
	    			createdAt: new Date().getTime()
				}

				await database.collection("groupChats").findOneAndUpdate({
					_id: group._id
				}, {
					$push: {
						members: obj
					}
				})

				result.json({
					status: "success",
					message: "Group has been joined."
				})
			})

		app.post("/fetchGroupChatDetail", async function (request, result) {
			const accessToken = request.fields.accessToken
	        const _id = request.fields._id ?? ""

	        const user = await database.collection("users").findOne({
	            accessToken: accessToken
	        })

	        if (user == null) {
	            result.json({
	                status: "error",
	                message: "User has been logged out. Please login again."
	            })

	            return
	        }

	        if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})

				return
			}

			const group = await database.collection("groupChats").findOne({
				_id: ObjectId(_id)
		    })

		    if (group == null) {
				result.json({
					status: "error",
					message: "Group not found."
				})

				return
			}

			result.json({
				status: "success",
				message: "Data has been fetched.",
				group: group,
				user: user._id
			})
		})

		app.get("/joinGroupChat/:_id", async function (request, result) {
			result.render("joinGroupChat", {
				_id: request.params._id
			})
		})

		app.post("/fetchGroupMembers", async function (request, result) {
			const accessToken = request.fields.accessToken
	        const _id = request.fields._id ?? ""

	        const user = await database.collection("users").findOne({
	            accessToken: accessToken
	        })

	        if (user == null) {
	            result.json({
	                status: "error",
	                message: "User has been logged out. Please login again."
	            })

	            return
	        }

	        if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})

				return
			}

			const group = await database.collection("groupChats").findOne({
				_id: ObjectId(_id)
		    })

		    if (group == null) {
				result.json({
					status: "error",
					message: "Group not found."
				})

				return
			}

		    let isMember = false
		    for (let a = 0; a < group.members.length; a++) {
		    	if (group.members[a].user._id.toString() == user._id.toString()
		    		&& group.members[a].status == "Accepted") {
		    		isMember = true
		    		break
		    	}
		    }

		    if (!isMember) {
				result.json({
					status: "error",
					message: "You are not a member of this group."
				})

				return
			}

			result.json({
				status: "success",
				message: "Data has been fetched.",
				data: group.members
			})
		})

		app.post("/deleteGroupChat", async function (request, result) {
			const accessToken = request.fields.accessToken
	        const _id = request.fields._id ?? ""

	        const user = await database.collection("users").findOne({
	            accessToken: accessToken
	        })

	        if (user == null) {
	            result.json({
	                status: "error",
	                message: "User has been logged out. Please login again."
	            })

	            return
	        }

	        if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})

				return
			}

			const group = await database.collection("groupChats").findOne({
				_id: ObjectId(_id)
		    })

		    if (group == null) {
				result.json({
					status: "error",
					message: "Group not found."
				})

				return
			}

		    if (group.createdBy._id.toString() != user._id.toString()) {
				result.json({
					status: "error",
					message: "Unauthorized."
				})

				return
			}

			const messages = await database.collection("messages").find({
				"group._id": group._id
			}).toArray()

			for (let a = 0; a < messages.length; a++) {
				for (let b = 0; b < messages[a].savedPaths.length; b++) {
					fileSystem.unlink(messages[a].savedPaths[b], function (error) {
						if (error) {
							console.error(error)
						}
					})
				}
			}

			await database.collection("messages").deleteMany({
				"group._id": group._id
			})

			for (let a = 0; a < group.savedPaths.length; a++) {
				fileSystem.unlink(group.savedPaths[a], function (error) {
					if (error) {
						console.error(error)
					}
				})
			}

			await database.collection("groupChats").deleteOne({
				_id: group._id
			})

			result.json({
				status: "success",
				message: "Group has been deleted."
			})
		})

		app.post("/deleteMemberFromGroupChat", async function (request, result) {
			const accessToken = request.fields.accessToken
	        const _id = request.fields._id
	        const memberId = request.fields.memberId

	        const user = await database.collection("users").findOne({
	            accessToken: accessToken
	        })

	        if (user == null) {
	            result.json({
	                status: "error",
	                message: "User has been logged out. Please login again."
	            })

	            return
	        }

	        if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})

				return
			}

	        const group = await database.collection("groupChats").findOne({
				_id: ObjectId(_id)
		    })

		    if (group == null) {
				result.json({
					status: "error",
					message: "Group not found."
				})

				return
			}

		    if (group.createdBy._id.toString() != user._id.toString()) {
				result.json({
					status: "error",
					message: "Unauthorized."
				})

				return
			}

			await database.collection("groupChats").findOneAndUpdate({
				_id: group._id
			}, {
				$pull: {
					members: {
						_id: ObjectId(memberId)
					}
				}
			})

			result.json({
				status: "success",
				message: "Member has been removed."
			})
		})

		app.post("/acceptInviteGroupChat", async function (request, result) {
			const accessToken = request.fields.accessToken
	        const _id = request.fields._id
	        const memberId = request.fields.memberId

	        const user = await database.collection("users").findOne({
	            accessToken: accessToken
	        })

	        if (user == null) {
	            result.json({
	                status: "error",
	                message: "User has been logged out. Please login again."
	            })

	            return
	        }

	        if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})

				return
			}

	        const group = await database.collection("groupChats").findOne({
				_id: ObjectId(_id)
		    })

		    if (group == null) {
				result.json({
					status: "error",
					message: "Group not found."
				})

				return
			}

			let isMember = false
		    for (let a = 0; a < group.members.length; a++) {
		    	if (group.members[a].user._id.toString() == user._id.toString()
		    		&& group.members[a]._id.toString() == memberId) {
		    		isMember = true
		    		break
		    	}
		    }

		    if (!isMember) {
				result.json({
					status: "error",
					message: "You are not a member of this group."
				})

				return
			}

			await database.collection("groupChats").findOneAndUpdate({
				$and: [{
					_id: group._id
				}, {
					"members._id": ObjectId(memberId)
				}]
			}, {
				$set: {
					"members.$.status": "Accepted"
				}
			})

			result.json({
				status: "success",
				message: "Invitation has been accepted."
			})
		})

		app.post("/sendVoiceNoteInGroupChat", async function (request, result) {
			const base64 = request.fields.base64
	        const accessToken = request.fields.accessToken
	        const _id = request.fields._id

	        const user = await database.collection("users").findOne({
	            "accessToken": accessToken
	        });

	        if (user == null) {
	            result.json({
	                "status": "error",
	                "message": "User has been logged out. Please login again."
	            });

	            return false;
	        }

	        if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})

				return
			}

	        const group = await database.collection("groupChats").findOne({
				_id: ObjectId(_id)
		    })

		    if (group == null) {
				result.json({
					status: "error",
					message: "Group not found."
				})

				return
			}

			let isMember = false
		    for (let a = 0; a < group.members.length; a++) {
		    	if (group.members[a].user._id.toString() == user._id.toString()
		    		&& group.members[a].status == "Accepted") {
		    		isMember = true
		    		break
		    	}
		    }

		    if (!isMember) {
				result.json({
					status: "error",
					message: "You are not a member of this group."
				})

				return
			}

	        const buffer = Buffer.from(base64, "base64")
	        const voiceNote = "voice-notes/" + new Date().getTime() + ".webm"
	        await fileSystem.writeFileSync(voiceNote, buffer)

	        const messageObj = {
				message: null,
				savedPaths: [],
				voiceNote: voiceNote,
				type: "group",
				group: {
					_id: group._id,
					name: group.name
				},
				user: {
					_id: user._id,
					name: user.name
				},
				isDeleted: false,
            	createdAt: new Date().getTime()
			}

			const response = await database.collection("messages").insertOne(messageObj)
			messageObj._id = response.insertedId

	        result.json({
	            "status": "success",
	            "message": "Message has been sent.",
	            "data": messageObj
	        })
		})

		app.post("/deleteGroupMessage", async function (request, result) {
			const accessToken = request.fields.accessToken
		    const _id = request.fields._id ?? ""

		    const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})

				return
			}

			const message = await database.collection("messages").findOne({
				_id: ObjectId(_id)
			})

			if (message == null) {
				result.json({
					status: "error",
					message: "Message does not exists."
				})

				return
			}

			if (message.user._id.toString() != user._id.toString()) {
				result.json({
					status: "error",
					message: "Unauthorized."
				})

				return
			}

			const group = await database.collection("groupChats").findOne({
				_id: message.group._id
		    })

		    if (group == null) {
				result.json({
					status: "error",
					message: "Group not found."
				})

				return
			}

			let isMember = false
		    for (let a = 0; a < group.members.length; a++) {
		    	if (group.members[a].user._id.toString() == user._id.toString()
		    		&& group.members[a].status == "Accepted") {
		    		isMember = true
		    		break
		    	}
		    }

		    if (!isMember) {
				result.json({
					status: "error",
					message: "You are not a member of this group."
				})

				return
			}

			await database.collection("messages").findOneAndUpdate({
				_id: message._id
			}, {
				$set: {
					isDeleted: true
				}
			})

			result.json({
				status: "success",
				message: "Message has been deleted."
			})
		})

		app.post("/inviteMemberForGroupChat", async function (request, result) {
			// get logged-in users
		    const accessToken = request.fields.accessToken
		    const _id = request.fields._id ?? ""
		    const email = request.fields.email ?? ""

		    const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})
				return
			}

			const group = await database.collection("groupChats").findOne({
				_id: ObjectId(_id)
		    })

		    if (group == null) {
				result.json({
					status: "error",
					message: "Group not found."
				})

				return
			}

			/*let isMember = false
		    for (let a = 0; a < group.members.length; a++) {
		    	if (group.members[a].user._id.toString() == user._id.toString()
		    		&& group.members[a].status == "Accepted") {
		    		isMember = true
		    		break
		    	}
		    }

		    if (!isMember) {
				result.json({
					status: "error",
					message: "You are not a member of this group."
				})

				return
			}*/

			if (group.createdBy._id.toString() != user._id.toString()) {
				result.json({
					status: "error",
					message: "Unauthorized."
				})

				return
			}

			const otherUser = await database.collection("users").findOne({
				email: email
			})
			
			if (otherUser == null) {
				result.json({
					status: "error",
					message: "User does not exists."
				})

				return
			}

			for (let a = 0; a < group.members.length; a++) {
				if (group.members[a].user._id.toString() == otherUser._id.toString()) {
					result.json({
						status: "error",
						message: "User is already a member of this group."
					})

					return
				}
			}

			const obj = {
				_id: ObjectId(),
				status: "Pending",
    			user: {
    				_id: otherUser._id,
    				name: otherUser.name
    			},
    			invitedBy: {
    				_id: user._id,
    				name: user.name
    			},
    			createdAt: new Date().getTime()
			}

			await database.collection("groupChats").findOneAndUpdate({
				_id: group._id
			}, {
				$push: {
					members: obj
				}
			})

			result.json({
				status: "success",
				message: "Invitation has been sent."
			})
		})

		app.post("/getGroupChat", async function (request, result) {
			// get logged-in users
		    const accessToken = request.fields.accessToken
		    const _id = request.fields._id ?? ""

		    const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})
				return
			}

			const group = await database.collection("groupChats").findOne({
				_id: ObjectId(_id)
		    })

		    if (group == null) {
				result.json({
					status: "error",
					message: "Group not found."
				})

				return
			}

			const data = []
			const messages = await database.collection("messages").find({
				$and: [{
					"group._id": group._id
				}, {
					isDeleted: false
				}]
			})
				.sort({
					createdAt: -1
				})
				.toArray()

			for (let a = 0; a < messages.length; a++) {
		        data.push({
		            _id: messages[a]._id.toString(),
		            message: messages[a].message ? cryptr.decrypt(messages[a].message) : "",
		            voiceNote: messages[a].voiceNote,
		            savedPaths: messages[a].savedPaths,
					user: messages[a].user,
	            	createdAt: messages[a].createdAt
		        })
		    }

			result.json({
				status: "success",
				message: "Data has been fetched.",
				data: data
			})
		})

		app.post("/sendGroupMessage", async function (request, result) {
			// get logged-in users
		    const accessToken = request.fields.accessToken
		    const message = request.fields.message ?? ""
		    const _id = request.fields._id ?? ""

		    const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})
				return
			}

			const group = await database.collection("groupChats").findOne({
				_id: ObjectId(_id)
		    })

		    if (group == null) {
				result.json({
					status: "error",
					message: "Group not found."
				})

				return
			}

			let isMember = false
		    for (let a = 0; a < group.members.length; a++) {
		    	if (group.members[a].user._id.toString() == user._id.toString()
		    		&& group.members[a].status == "Accepted") {
		    		isMember = true
		    		break
		    	}
		    }

		    if (!isMember) {
				result.json({
					status: "error",
					message: "You are not a member of this group."
				})

				return
			}

			const files = []
	        if (Array.isArray(request.files.files)) {
	            for (let a = 0; a < request.files.files.length; a++) {
	                files.push(request.files.files[a])
	            }
	        } else {
	            files.push(request.files.files)
	        }

	        functions.callbackFileUpload(files, 0, [], async function (savedPaths) {
	        	const messageObj = {
					message: cryptr.encrypt(message),
					savedPaths: savedPaths,
					type: "group",
					group: {
						_id: group._id,
						name: group.name
					},
					user: {
						_id: user._id,
						name: user.name
					},
					isDeleted: false,
	            	createdAt: new Date().getTime()
				}

				const response = await database.collection("messages").insertOne(messageObj)

				messageObj.message = cryptr.decrypt(messageObj.message)
				messageObj._id = response.insertedId

				result.json({
		            status: "success",
		            message: "Message has been sent.",
		            data: messageObj
		        })
	        })
		})

		// POST API to fetch groups
		app.post("/fetchGroupsForChat", async function (request, result) {
		    // get logged-in users
		    const accessToken = request.fields.accessToken

		    const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})
				return
			}
		 
		    // get groups of which I am an admin or a member
		    const groups = await database.collection("groupChats").find({
		        "members.user._id": user._id
		    })
		        .sort({
		            createdAt: -1
		        })
		        .toArray();
		 
		    // return the groups and logged-in user object
		    result.json({
		        status: "success",
		        message: "Groups has been fetched.",
		        groups: groups
		    })
		})

		app.post("/createGroupForChat", async function (request, result) {
			const accessToken = request.fields.accessToken
			const name = request.fields.name ?? ""

			const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})
				return
			}

			const files = []
	        if (Array.isArray(request.files.coverPhoto)) {
	            for (let a = 0; a < request.files.coverPhoto.length; a++) {
	                files.push(request.files.coverPhoto[a])
	            }
	        } else {
	            files.push(request.files.coverPhoto)
	        }

	        functions.callbackFileUpload(files, 0, [], async function (savedPaths) {
	        	const obj = {
	        		name: name,
	        		savedPaths: savedPaths,
	        		members: [{
	        			_id: ObjectId(),
	        			status: "Accepted",
	        			user: {
	        				_id: user._id,
	        				name: user.name
	        			},
	        			createdAt: new Date().getTime()
	        		}],
	        		createdBy: {
	        			_id: user._id,
	        			name: user.name
	        		},
	        		createdAt: new Date().getTime()
	        	}
	        	const response = await database.collection("groupChats").insertOne(obj)
	        	obj._id = response.insertedId

	        	result.json({
					status: "success",
					message: "Group has been created.",
					group: obj
				})
	        })
		})

		app.get("/groupChat", function (request, result) {
			result.render("groupChat")
		})

		app.post("/fetchNearby", async function (request, result) {
			const accessToken = request.fields.accessToken

			const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})
				return
			}

			const data = []
			if (typeof user.location !== "undefined") {
				let users = await database.collection("users").find({
					$and: [{
						_id: {
							$ne: user._id
						}
					}, {
						"location.city": user.location.city
					}]
				}).toArray()

				users = users.sort(function (a, b) {
					return 0.5 - Math.random()
				})

				for (let a = 0; a < users.length; a++) {
					data.push({
						_id: users[a]._id,
						name: users[a].name,
						profileImage: users[a].profileImage,
						city: users[a].location.city
					})
				}
			}

			result.json({
				status: "success",
				message: "Data has been fetched.",
				data: data
			})
		})

		app.get("/people-nearby", async function (request, result) {
			result.render("people-nearby")
		})

		app.post("/watchVideoPlayed", async function (request, result) {
			const accessToken = request.fields.accessToken
			const src = request.fields.src
			const postId = request.fields.postId

			const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})
				return
			}

			const post = await database.collection("posts").findOne({
				_id: ObjectId(postId)
			})

			if (post == null) {
				result.json({
					status: "error",
					message: "Post not found."
				})

				return
			}

			let updatedViews = 0
			const videos = post.videos || []
			for (let a = 0; a < videos.length; a++) {
				if (videos[a].src == src) {
					const viewers = videos[a].viewers || []
					updatedViews = viewers.length
					let flag = false
					for (let b = 0; b < viewers.length; b++) {
						if (viewers[b]._id.toString() == user._id.toString()) {
							flag = true
							break
						}
					}

					if (!flag) {
						await database.collection("posts").findOneAndUpdate({
							$and: [{
								_id: ObjectId(postId)
							}, {
								"videos.src": src
							}]
						}, {
							$push: {
								"videos.$.viewers": {
									_id: user._id
								}
							}
						})
						updatedViews++
					}

					break
				}
			}

			result.json({
				status: "success",
				message: "Video has been marked as watched.",
				updatedViews: updatedViews
			})
		})

		app.post("/fetchWatch", async function (request, result) {
			const accessToken = request.fields.accessToken

			const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})
				return
			}

			var ids = []
			ids.push(user._id)

			for (var a = 0; a < user.pages.length; a++) {
				ids.push(user.pages[a]._id);
			}

			for (var a = 0; a < user.groups.length; a++) {
				if (user.groups[a].status == "Accepted") {
					ids.push(user.groups[a]._id);
				}
			}

			for (var a = 0; a < user.friends.length; a++) {
                if (user.friends[a].status == "Accepted") {
					ids.push(user.friends[a]._id);
                }
			}

			const advertisements = await database.collection("advertisements").find({
				$and: [{
					whereToShow: "newsfeed"
				}, {
					status: "active"
				}]
			}).toArray()

			const postIds = []
			for (let a = 0; a < advertisements.length; a++) {
				postIds.push(advertisements[a].post._id)
			}

			let posts = await database.collection("posts")
				.find({
					$and: [{
						$or: [{
							savedPaths: {
								$regex: ".mp4"
							}
						}, {
							savedPaths: {
								$regex: ".mkv"
							}
						}, {
							savedPaths: {
								$regex: ".mov"
							}
						}]
					}, {
						$and: [{
							_id: {
								$in: postIds
							}
						}, {
							isBoost: true
						}]
					}]
				})
				.toArray()

			posts = posts.sort(function (a, b) {
				return 0.5 - Math.random()
			})

			const data = []
			for (let a = 0; a < posts.length; a++) {
				const savedPaths = []
				for (let b = 0; b < posts[a].savedPaths.length; b++) {
					if (posts[a].savedPaths[b].includes(".mp4")
						|| posts[a].savedPaths[b].includes(".mkv")
						|| posts[a].savedPaths[b].includes(".mov")) {
						savedPaths.push(posts[a].savedPaths[b])
					}
				}
				posts[a].savedPaths = savedPaths
				data.push(posts[a])
			}

			result.json({
				status: "success",
				message: "Data has been fetched.",
				data: data
			})
		})


		app.get("/watch", function (request, result) {
			result.render("watch")
		})

		app.post("/fetchMyAds", async function (request, result) {
			const accessToken = request.fields.accessToken

			const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})
				return
			}

			const ads = await database.collection("advertisements").find({
				"user._id": user._id
			})
				.sort({ createdAt: -1 })
				.toArray()

			result.json({
				status: "success",
				message: "Data has been fetched.",
				ads: ads
			})
		})

		app.get("/ads", async function (request, result) {
			result.render("myAds")
		})

		app.post("/getRandomAd", async function (request, result) {
			const totalAds = await database.collection("advertisements").find({
				$and: [{
					whereToShow: "chat"
				}, {
					status: "active"
				}]
			}).count()

			const randomAd = Math.floor(Math.random() * totalAds)

			const advertisements = await database.collection("advertisements").find({
				$and: [{
					whereToShow: "chat"
				}, {
					status: "active"
				}]
			})
				.skip(randomAd)
				.limit(1)
				.toArray()

			const postIds = []
			for (let a = 0; a < advertisements.length; a++) {
				postIds.push(advertisements[a].post._id)
			}

			let posts = await database.collection("posts").find({
				$and: [{
					_id: {
						$in: postIds
					}
				}, {
					isBoost: true
				}]
			}).toArray()

			posts = posts.sort(function (a, b) {
				return 0.5 - Math.random()
			})

			result.json({
				status: "success",
				message: "Data has been fetched.",
				posts: posts
			})
		})

		app.post("/doBoostPost", async function (request, result) {
			const _id = request.fields._id
			const budget = request.fields.budget
			const gender = request.fields.gender || "both"
			const whereToShow = JSON.parse(request.fields.whereToShow)
			const paymentId = request.fields.paymentId
			const accessToken = request.fields.accessToken

			const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})
				return
			}

			const post = await database.collection("posts").findOne({
				_id: ObjectId(_id)
			})

			if (post == null) {
				result.json({
					status: "error",
					message: "Post not found."
				})
				return
			}

			if (post.isBoost) {
				result.json({
					status: "error",
					message: "Post is already boosted."
				})
				return
			}

			let isMyUploaded = false
			if (post.type == "group_post") {
				if (post.uploader._id.toString() == user._id.toString()) {
					isMyUploaded = true
				}
			} else if (post.user._id.toString() == user._id.toString()) {
				isMyUploaded = true
			}

			if (!isMyUploaded) {
				result.json({
					status: "error",
					message: "Unauthorized."
				})
				return
			}

			const settings = await database.collection("settings").findOne({})
			if (settings == null) {
				result.json({
					status: "error",
					message: "Stripe settings are not configured."
				})
				return
			}
			const stripe = Stripe(settings?.stripe?.secret_key)

			// verify stripe intent
			const paymentIntent = await stripe.paymentIntents.retrieve(
				paymentId
			)

			if (paymentIntent != null) {
				if (paymentIntent.status != "succeeded") {
					result.json({
						status: "error",
						message: "Sorry, payment not verified."
					})

					return
				}
			}

			await database.collection("posts").findOneAndUpdate({
				_id: post._id
			}, {
				$set: {
					isBoost: true
				}
			})

			const todayDate = new Date()
			const numberOfDaysToAdd = parseInt(budget)
			const newDate = todayDate.setDate(todayDate.getDate() + numberOfDaysToAdd)
			const endAt = new Date(newDate).getTime()

			await database.collection("advertisements").insertOne({
				budget: budget,
				whereToShow: whereToShow,
				user: {
					_id: user._id,
					name: user.name,
					email: user.email
				},
				post: {
					_id: post._id,
					caption: post.caption,
					savedPaths: post.savedPaths,
		            youtube_url: post.youtube_url,
		            type: post.type,
		            createdAt: post.createdAt,
				},
				gender: gender,
				status: "active", // active, inactive
				paymentId: paymentId,
				paymentIntent: paymentIntent,
				type: "Stripe",
				createdAt: new Date().getTime(),
				endAt: endAt
			})

			result.json({
				status: "success",
				message: "Post has been boosted."
			})
		})

		app.post("/createStripeIntent", async function (request, result) {
			const amount = request.fields.amount * 100
			const accessToken = request.fields.accessToken

			const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})
				return
			}

			const settings = await database.collection("settings").findOne({})
			if (settings == null) {
				result.json({
					status: "error",
					message: "Stripe settings are not configured."
				})
				return
			}
			const stripe = Stripe(settings?.stripe?.secret_key)

			const paymentIntent = await stripe.paymentIntents.create({
				amount: amount,
				currency: 'usd',
				payment_method_types: ['card'],
			})

			result.json({
				status: "success",
				message: "Intent has been created.",
				clientSecret: paymentIntent.client_secret
			})
		})

		app.post("/fetchPostForBoost", async function (request, result) {
			const _id = request.fields._id
			const accessToken = request.fields.accessToken

			const user = await database.collection("users").findOne({
				accessToken: accessToken
			})
			
			if (user == null) {
				result.json({
					status: "error",
					message: "User has been logged out. Please login again."
				})
				return
			}
			
			if (user.isBanned) {
				result.json({
					status: "error",
					message: "You have been banned."
				})
				return
			}

			const post = await database.collection("posts").findOne({
				_id: ObjectId(_id)
			})

			if (post == null) {
				result.json({
					status: "error",
					message: "Post not found."
				})
				return
			}

			if (post.isBoost) {
				result.json({
					status: "error",
					message: "Post is already boosted."
				})
				return
			}

			let isMyUploaded = false;
			if (post.type == "group_post") {
				if (post.uploader._id.toString() == user._id.toString()) {
					isMyUploaded = true
				}
			} else if (post.user._id.toString() == user._id.toString()) {
				isMyUploaded = true
			}

			if (!isMyUploaded) {
				result.json({
					status: "error",
					message: "Unauthorized."
				})
				return
			}

			result.json({
				status: "success",
				message: "Data has been fetched.",
				post: {
					_id: post._id,
					caption: post.caption,
					savedPaths: post.savedPaths,
					youtube_url: post.youtube_url,
					type: post.type,
					createdAt: post.createdAt,
					likers: post.likers?.length || [],
					dislikers: post.dislikers?.length || [],
					comments: post.comments?.length || [],
					shares: post.shares?.length || []
				}
			})
		})

		app.get("/boostPost/:_id", async function (request, result) {
			const _id = request.params._id

			const settings = await database.collection("settings").findOne({})
			if (settings == null) {
				result.send("Stripe settings are not configured.")
				return
			}
			const stripePublicKey = settings?.stripe?.publishable_key

			result.render("boostPost", {
				_id: _id,
				stripePublicKey: stripePublicKey
			})
		})

		app.post("/deleteEvent", async function (request, result) {
			const accessToken = request.fields.accessToken
			const _id = request.fields._id
			
			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})
			
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})
				return false
			}
			
			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})
				return false
			}

			const event = await database.collection("events").findOne({
				_id: ObjectId(_id)
			})

			if (event == null) {
				result.json({
					"status": "error",
					"message": "Event not found."
				})
				return false
			}

			if (event.user._id.toString() != user._id.toString()) {
				result.json({
					"status": "error",
					"message": "Sorry, you are not authorized to delete this event."
				})
				return false
			}

			if (event.image != "") {
				fileSystem.unlink(event.image, function (error) {
					if (error) {
						console.error(error)
					}
				})
			}

			if (event.video != "") {
				fileSystem.unlink(event.video, function (error) {
					if (error) {
						console.error(error)
					}
				})
			}

			await database.collection("events").deleteOne({
				_id: event._id
			})

			result.json({
				"status": "success",
				"message": "Event has been deleted."
			})
		})

		app.post("/notGoingToEvent", async function (request, result) {
			const accessToken = request.fields.accessToken
			const _id = request.fields._id
			
			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})
			
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})
				return false
			}
			
			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})
				return false
			}

			const event = await database.collection("events").findOne({
				_id: ObjectId(_id)
			})

			if (event == null) {
				result.json({
					"status": "error",
					"message": "Event not found."
				})
				return false
			}

			let isGoing = false
			for (let a = 0; a < event.going.length; a++) {
				if (event.going[a]._id.toString() == user._id.toString()) {
					isGoing = true
					break
				}
			}

			if (!isGoing) {
				result.json({
					"status": "error",
					"message": "You are already not going to this event."
				})
				return false
			}

			await database.collection("events").findOneAndUpdate({
				_id: event._id
			}, {
				$pull: {
					"going": {
						_id: user._id
					}
				}
			})

			result.json({
				status: "success",
				message: "You are not going to this event."
			})
		})

		app.post("/goingToEvent", async function (request, result) {
			const accessToken = request.fields.accessToken
			const _id = request.fields._id
			
			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})
			
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})
				return false
			}
			
			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})
				return false
			}

			const event = await database.collection("events").findOne({
				_id: ObjectId(_id)
			})

			if (event == null) {
				result.json({
					"status": "error",
					"message": "Event not found."
				})
				return false
			}

			for (let a = 0; a < event.going.length; a++) {
				if (event.going[a]._id.toString() == user._id.toString()) {
					result.json({
						"status": "error",
						"message": "You are already going to this event."
					})
					return false
				}
			}

			await database.collection("events").findOneAndUpdate({
				_id: event._id
			}, {
				$push: {
					"going": {
						_id: user._id,
						name: user.name,
						profileImage: user.profileImage
					}
				}
			})

			result.json({
				status: "success",
				message: "You are going to this event."
			})
		})

		app.post("/getEventDetail", async function (request, result) {
			const accessToken = request.fields.accessToken
			const _id = request.fields._id
			
			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})
			
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})
				return false
			}
			
			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})
				return false
			}

			const event = await database.collection("events").findOne({
				_id: ObjectId(_id)
			})

			if (event == null) {
				result.json({
					"status": "error",
					"message": "Event not found."
				})
				return false
			}

			event.eventDate = getUTCToTZInFormat(event.eventDate)

			result.json({
				status: "success",
				message: "Data has been fetched.",
				event: event
			})
		})

		app.get("/event/:_id", function (request, result) {
			result.render("eventDetail", {
				_id: request.params._id
			})
		})

		app.post("/getEvents", async function (request, result) {
			const accessToken = request.fields.accessToken
			
			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})
			
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})
				return false
			}
			
			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})
				return false
			}

			const data = await database.collection("events").find({
				"user._id": user._id
			}).sort({
				"eventDate": -1
			}).toArray()

			for (let a = 0; a < data.length; a++) {
				data[a].eventDate = getUTCToTZInFormat(data[a].eventDate)
			}

			const currentDate = new Date().toISOString()
			const upcomingEvents = await database.collection("events").find({
				"eventDate": {
					$gt: currentDate
				}
			}).sort({
				"eventDate": -1
			}).toArray()

			for (let a = 0; a < upcomingEvents.length; a++) {
				upcomingEvents[a].eventDate = getUTCToTZInFormat(upcomingEvents[a].eventDate)
			}

			const goingEvents = await database.collection("events").find({
				"going._id": user._id
			}).sort({
				"eventDate": -1
			}).toArray()

			for (let a = 0; a < goingEvents.length; a++) {
				goingEvents[a].eventDate = getUTCToTZInFormat(goingEvents[a].eventDate)
			}

			result.json({
				status: "success",
				message: "Data has been fetched.",
				data: data,
				upcomingEvents: upcomingEvents,
				goingEvents: goingEvents
			})
		})

		app.post("/createEvent", async function (request, result) {
			const accessToken = request.fields.accessToken
			const name = request.fields.name
			const location = request.fields.location
			const description = request.fields.description
			let image = ""
			let video = ""
			const comments = []
			const going = []
			const eventDate = request.fields.eventDate
			const createdAt = new Date().getTime()

			const eventDateTime = moment.tz(eventDate.split("T").join(" "), moment.tz.guess())
			const eventDateTimeUTC = eventDateTime.utc().format()

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})
				return false
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})
				return false
			}

			if (request.files.image.size > 0 && request.files.image.type.includes("image")) {
				image = "public/images/event-" + new Date().getTime() + "-" + request.files.image.name

				// Read the file
				fileSystem.readFile(request.files.image.path, function (err, data) {
					if (err) throw err
					console.log('File read!')

					// Write the file
					fileSystem.writeFile(image, data, function (err) {
						if (err) throw err
						console.log('File written!')
					})

					// Delete the file
					fileSystem.unlink(request.files.image.path, function (err) {
						if (err) throw err
						console.log('File deleted!')
					})
				})
			}

			if (request.files.video.size > 0 && request.files.video.type.includes("video")) {
				video = "public/videos/event-" + new Date().getTime() + "-" + request.files.video.name

				// Read the file
				fileSystem.readFile(request.files.video.path, function (err, data) {
					if (err) throw err
					console.log('File read!')

					// Write the file
					fileSystem.writeFile(video, data, function (err) {
						if (err) throw err
						console.log('File written!')
					})

					// Delete the file
					fileSystem.unlink(request.files.video.path, function (err) {
						if (err) throw err
						console.log('File deleted!')
					})
				})
			}

			going.push({
				_id: user._id,
				name: user.name,
				profileImage: user.profileImage
			})

			const event = await database.collection("events").insertOne({
				name: name,
				description: description,
				location: location,
				user: {
					_id: user._id,
					name: user.name,
					username: user.username,
					profileImage: user.profileImage
				},
				image: image,
				video: video,
				eventDate: eventDateTimeUTC,
				comments: comments,
				going: going,
				createdAt: createdAt
			})

			let updatedEvent = event.ops[0]
			updatedEvent.eventDate = getUTCToTZInFormat(eventDateTimeUTC)

			result.json({
				"status": "success",
				"message": "Event has been created.",
				"event": updatedEvent
			})
		})

		app.get("/events", function (request, result) {
			result.render("events")
		})

		app.post("/deleteStory", async function (request, result) {
			const accessToken = request.fields.accessToken;
			const _id = request.fields._id;

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			});

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}

			const story = await database.collection("stories").findOne({
				"_id": ObjectId(_id)
			});

			if (story == null) {
				result.json({
					"status": "error",
					"message": "Story does not exist."
				});
				return false;
			}

			if (story.user._id.toString() != user._id.toString()) {
				result.json({
					"status": "error",
					"message": "Unauthorized."
				});
				return false;
			}

			// if (story.attachment != "" && (await fileSystem.existsSync(story.attachment))) {
			// 	fileSystem.unlink(story.attachment, function (error) {
			// 		console.log("Story attachment has been deleted: " + error);
			// 	});
			// }

			// await database.collection("stories").deleteOne({
	        //     "_id": story._id
	        // });

			result.json({
				"status": "success",
				"message": "Story has been deleted."
			});
		});

		app.post("/storyViewed", async function (request, result) {
			const accessToken = request.fields.accessToken;
			const _id = request.fields._id;

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			});

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}

			if (!ObjectId.isValid(_id)) {
				result.json({
					"status": "error",
					"message": "Invalid ID."
				});
				return false;
			}

			const story = await database.collection("stories").findOne({
				"_id": ObjectId(_id)
			});

			if (story == null) {
				result.json({
					"status": "error",
					"message": "Story does not exist."
				});
				return false;
			}

			const isFriend = functions.isUserFriend(user, story.user._id);

			if (story.user._id.toString() != user._id.toString() && !isFriend) {
				result.json({
					"status": "error",
					"message": "Unauthorized."
				});
				return false;
			}

			let hasViewed = false;
			for (let a = 0; a < story.viewers.length; a++) {
				if (story.viewers[a].user._id.toString() == user._id.toString()) {
					hasViewed = true;
					break;
				}
			}

			if (story.user._id.toString() != user._id.toString() && !hasViewed) {
				await database.collection("stories").updateOne({
					"_id": story._id
				}, {
					$push: {
						"viewers": {
							_id: ObjectId(),
							user: {
								_id: user._id,
								name: user.name,
								profileImage: user.profileImage
							},
							createdAt: new Date().getTime()
						}
					}
				});
			}

			result.json({
				"status": "success",
				"message": "Story has been viewed."
			});
		});

		app.post("/getSingleStory", async function (request, result) {
			const accessToken = request.fields.accessToken;
			const userId = request.fields.userId;

			var user = await database.collection("users").findOne({
				"accessToken": accessToken
			});

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}

			const isFriend = functions.isUserFriend(user, userId);

			if (userId != user._id.toString() && !isFriend) {
				result.json({
					"status": "error",
					"message": "Unauthorized."
				});
				return false;
			}

			const stories = await database.collection("stories").find({
				$and: [{
					"user._id": ObjectId(userId)
				}, {
					"status": "active"
				}]
			}).toArray();

			if (isFriend) {
				for (let a = 0; a < stories.length; a++) {
					delete stories[a].viewers;
				}
			}

			for (const story of stories) {
				if (story.attachment != "") {
					story.attachment = mainURL + "/" + story.attachment
				}
			}

			result.json({
				"status": "success",
				"message": "Data has been fetched.",
				"stories": stories,
				"isMyStory": (userId == user._id.toString())
			});
		});

		app.get("/viewStory/:userId", async function (request, result) {
			const userId = request.params.userId;

			result.render("viewStory", {
				"userId": userId
			});
		});

		app.post("/getStories", async function (request, result) {
			const accessToken = request.fields.accessToken;
		
			var user = await database.collection("users").findOne({
				"accessToken": accessToken
			});

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}

			const myStories = await database.collection("stories").find({
				$and: [{
					"user._id": user._id
				}, {
					"status": "active"
				}]
			}).toArray();

			let data = [];
			for (let a = 0; a < myStories.length; a++) {
				data.push(myStories[a]);
			}

			let myFriendsIds = [];
			for (let a = 0; a < user.friends.length; a++) {
				myFriendsIds.push(user.friends[a]._id);
			}

			const myFriendStories = await database.collection("stories").find({
				$and: [{
					"user._id": {
						$in: myFriendsIds
					}
				}, {
					"status": "active"
				}]
			}).toArray();

			for (let a = 0; a < myFriendStories.length; a++) {
				data.push(myFriendStories[a]);
			}

			let newArr = [];
			for (let a = 0; a < data.length; a++) {
				let flag = false;
				for (let b = 0; b < newArr.length; b++) {
					if (data[a].user._id.toString() == newArr[b].user._id.toString()) {
						flag = true;
						break;
					}
				}
				if (!flag) {
					newArr.push(data[a]);
				}
			}

			for (const a of newArr) {
				a.attachment = mainURL + "/" + a.attachment
				a.user.profileImage = mainURL + "/" + a.user.profileImage
			}

			result.json({
				"status": "success",
				"message": "Data has been fetched.",
				"data": newArr
			});
		});

		app.get("/addStory", function (request, result) {
			result.render("addStory");
		})

		app.post("/addStory", async function (request, result) {
				const accessToken = request.fields.accessToken;
				const length = request.fields.length;
			
				var user = await database.collection("users").findOne({
					"accessToken": accessToken
				});

				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
					return false;
				}

				functions.addStory(request, user, length, 0, function () {
					result.json({
						"status": "success",
						"message": "Story has been added."
					});
				}, function (error) {
					result.json({
						"status": "error",
						"message": error
					});
				});
			});

		app.get("/signup", function (request, result) {
			result.render("signup");
		});

		app.get("/forgot-password", function (request, result) {
			result.render("forgot-password");
		});

		app.post("/sendRecoveryLink", async function (request, result) {

			var email = request.fields.email;

			let smtpHost = ""
			let smtpPort = ""
			let smtpEmail = ""
			let smtpPassword = ""

			const settings = await database.collection("settings").findOne({})
			if (settings != null) {
				smtpHost = settings?.smtp?.host ?? ""
				smtpPort = settings?.smtp?.port ?? ""
				smtpEmail = settings?.smtp?.email ?? ""
				smtpPassword = settings?.smtp?.password ?? ""
			}

			if (!smtpHost || !smtpPort || !smtpEmail || !smtpPassword) {
				result.json({
					'status': "error",
					'message': 'SMTP is not configured.'
				});
		        return;
			}
			
			database.collection("users").findOne({
				"email": email
			}, function (error, user) {
				if (user == null) {
					result.json({
						'status': "error",
						'message': "Email does not exists."
					});
				} else {
					var reset_token = new Date().getTime();
					
					database.collection("users").findOneAndUpdate({
						"email": email
					}, {
						$set: {
							"reset_token": reset_token
						}
					}, function (error, data) {
						
						var transporter = nodemailer.createTransport({
							host: smtpHost,
						    port: smtpPort,
						    secure: true,
							auth: {
								user: smtpEmail,
								pass: smtpPassword
							}
						});

						var text = "Please click the following link to reset your password: " + mainURL + "/ResetPassword/" + email + "/" + reset_token;
						var html = "Please click the following link to reset your password: <br><br> <a href='" + mainURL + "/ResetPassword/" + email + "/" + reset_token + "'>Reset Password</a> <br><br> Thank you.";

						transporter.sendMail({
							from: smtpEmail,
							to: email,
							subject: "Reset Password",
							text: text,
							html: html
						}, function (error, info) {
							if (error) {
								console.error(error);
							} else {
								console.log("Email sent: " + info.response);
							}
							
							result.json({
								'status': "success",
								'message': 'Email has been sent with the link to recover the password.'
							});
						});
						
					});
				}
			});
		});

		app.get("/ResetPassword/:email/:reset_token", function (request, result) {

			var email = request.params.email;
			var reset_token = request.params.reset_token;

			result.render("reset-password", {
				"email": email,
				"reset_token": reset_token
			});
		});

		app.get("/verifyEmail/:email/:verification_token", function (request, result) {

			var email = request.params.email;
			var verification_token = request.params.verification_token;

			database.collection("users").findOne({
				$and: [{
					"email": email,
				}, {
					"verification_token": parseInt(verification_token)
				}]
			}, function (error, user) {
				if (user == null) {
					result.send('Email does not exists. Or verification link is expired.');
					return
				} else {

					database.collection("users").findOneAndUpdate({
						$and: [{
							"email": email,
						}, {
							"verification_token": parseInt(verification_token)
						}]
					}, {
						$set: {
							"verification_token": "",
							"isVerified": true
						}
					}, function (error, data) {
						result.send('Account has been verified. Please try login.');
						return
					});
				}
			});
		});

		app.post("/ResetPassword", async function (request, result) {
		    var email = request.fields.email;
		    var reset_token = request.fields.reset_token;
		    var new_password = request.fields.new_password;
		    var confirm_password = request.fields.confirm_password;

		    if (new_password != confirm_password) {
		    	result.json({
					'status': "error",
					'message': 'Password does not match.'
				});
		        return;
		    }

		    database.collection("users").findOne({
				$and: [{
					"email": email,
				}, {
					"reset_token": parseInt(reset_token)
				}]
			}, function (error, user) {
				if (user == null) {
					result.json({
						'status': "error",
						'message': 'Email does not exists. Or recovery link is expired.'
					});
				} else {

					bcrypt.genSalt(10, function(err, salt) {
						bcrypt.hash(new_password, salt, async function(err, hash) {
							database.collection("users").findOneAndUpdate({
								$and: [{
									"email": email,
								}, {
									"reset_token": parseInt(reset_token)
								}]
							}, {
								$set: {
									"reset_token": "",
									"password": hash
								}
							}, function (error, data) {
								result.json({
									'status': "success",
									'message': 'Password has been changed. Please try login again.'
								})
							})
						})
					})
				}
			})
		})

		app.get("/change-password", function (request, result) {
			result.render("change-password");
		});

		app.post("/changePassword", function (request, result) {
			
			var accessToken = request.fields.accessToken;
			var current_password = request.fields.current_password;
			var new_password = request.fields.new_password;
			var confirm_password = request.fields.confirm_password;

			if (new_password != confirm_password) {
		    	result.json({
					'status': "error",
					'message': 'Password does not match.'
				});
		        return;
		    }

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					bcrypt.compare(current_password, user.password, async function(err, res) {
						if (res === true) {
							bcrypt.genSalt(10, function(err, salt) {
								bcrypt.hash(new_password, salt, async function(err, hash) {
									database.collection("users").findOneAndUpdate({
										"accessToken": accessToken
									}, {
										$set: {
											"password": hash
										}
									}, function (error, data) {
										result.json({
											"status": "success",
											"message": "Password has been changed"
										})
									})
								})
							})
						} else {
							result.json({
								"status": "error",
								"message": "Current password is not correct"
							})
						}
					})
				}
			})
		})

		app.post("/signup", function (request, result) {
			var name = request.fields.name;
			var username = request.fields.username;
			var email = request.fields.email;
			var password = request.fields.password;
			var gender = request.fields.gender;
			var reset_token = "";
			let isVerified = false;
			var isBanned = false;
			var verification_token = new Date().getTime();
			// verification_token = ""

			database.collection("users").findOne({
				$or: [{
					"email": email
				}, {
					"username": username
				}]
			}, async function (error, user) {
				if (user == null) {

					let smtpHost = ""
					let smtpPort = ""
					let smtpEmail = ""
					let smtpPassword = ""

					const settings = await database.collection("settings").findOne({})
					if (settings != null) {
						smtpHost = settings?.smtp?.host ?? ""
						smtpPort = settings?.smtp?.port ?? ""
						smtpEmail = settings?.smtp?.email ?? ""
						smtpPassword = settings?.smtp?.password ?? ""
					} else {
						isVerified = true
					}

					bcrypt.genSalt(10, function(err, salt) {
					    bcrypt.hash(password, salt, async function(err, hash) {
					    	database.collection("users").insertOne({
								"name": name,
								"username": username,
								"email": email,
								"password": hash,
								"gender": gender,
								"reset_token": reset_token,
								"profileImage": "",
								"coverPhoto": "",
								"dob": "",
								"city": "",
								"country": "",
								"aboutMe": "",
								"friends": [],
								"pages": [],
								"notifications": [],
								"groups": [],
								"isVerified": isVerified,
								"verification_token": verification_token,
								"isBanned": isBanned
							}, function (error, data) {

								if (smtpHost && smtpPort && smtpEmail && smtpPassword) {
									var transporter = nodemailer.createTransport({
										host: smtpHost,
									    port: smtpPort,
									    secure: true,
										auth: {
											user: smtpEmail,
											pass: smtpPassword
										}
									});

									var text = "Please verify your account by click the following link: " + mainURL + "/verifyEmail/" + email + "/" + verification_token;
									var html = "Please verify your account by click the following link: <br><br> <a href='" + mainURL + "/verifyEmail/" + email + "/" + verification_token + "'>Confirm Email</a> <br><br> Thank you.";

									transporter.sendMail({
										from: smtpEmail,
										to: email,
										subject: "Email Verification",
										text: text,
										html: html
									}, function (error, info) {
										if (error) {
											console.error(error);
										} else {
											console.log("Email sent: " + info.response);
										}
										
										result.json({
											"status": "success",
											"message": "Signed up successfully. An email has been sent to verify your account. Once verified, you will be able to login and start using social network."
										});
										return

									});
									return
								} else {
									result.json({
										"status": "success",
										"message": "Signed up successfully. You can login now."
									});
									return
								}

								/*mongoClient.connect("mongodb://localhost:27017", {
									useUnifiedTopology: true
								}, async function (error, client) {
									var videoDatabase = client.db("youtube");
									console.log("Video streaming database connected.");

									const firstName = name.split(" ").length > 0 ? name.split(" ")[0] : name
									const lastName = name.split(" ").length > 1 ? name.split(" ")[1] : name

									await videoDatabase.collection("users").insertOne({
										"first_name": firstName,
										"last_name": lastName,
										"email": email,
										"password": hash,
										"subscribers": [],
										"reset_token": reset_token,
										"isVerified": isVerified,
										"verification_token": verification_token
									})

									result.json({
										"status": "success",
										"message": "Signed up successfully."
									})
								})*/
								
							})
					    })
					})
				} else {
					result.json({
						"status": "error",
						"message": "Email or username already exist."
					});
				}
			});
		});

		app.get("/login", function (request, result) {
			result.render("login");
		})

		app.post("/getKeys", async function (request, result) {
			const accessToken = request.fields.accessToken
			const _id = request.fields.user
			
			const me = await database.collection("users").findOne({
				accessToken: accessToken
			})

			if (me == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (me.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return
			}

			const user = await database.collection("users").findOne({
				_id: ObjectId(_id)
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User does not exists."
				})

				return
			}

			result.json({
				status: "success",
				message: "Data has been fetched.",
				privateKey: me.privateKey,
				publicKey: user.publicKey
			})
		})

		app.post("/updateKeys", async function (request, result) {
			const email = request.fields.email
			const publicKey = request.fields.publicKey
			const privateKey = request.fields.privateKey

			if (!email || !publicKey || !privateKey) {
				result.json({
					"status": "error",
					"message": "Please fill all fields."
				})
				return
			}

			const user = await database.collection("users").findOne({
				email: email
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return
			}

			await database.collection("users").findOneAndUpdate({
				_id: user._id
			}, {
				$set: {
					publicKey: publicKey,
					privateKey: privateKey
				}
			})

			result.json({
				"status": "success",
				"message": "Keys has been updated.",
				"profileImage": user.profileImage
			})
		})

		app.post("/login", function (request, result) {
			var email = request.fields.email;
			var password = request.fields.password;
			database.collection("users").findOne({
				"email": email
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "Email does not exist"
					});
					
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					bcrypt.compare(password, user.password, function (error, res) {
						if (res === true) {

							if (user.isVerified) {
								var accessToken = jwt.sign({ email: email }, accessTokenSecret);
								database.collection("users").findOneAndUpdate({
									"email": email
								}, {
									$set: {
										"accessToken": accessToken
									}
								}, function (error, data) {
									result.json({
										"status": "success",
										"message": "Login successfully",
										"accessToken": accessToken,
										"profileImage": user.profileImage,
										"hasKey": user.publicKey,
										"data": {
											_id: user._id,
											name: user.name,
											username: user.username,
											email: user.email,
											gender: user.gender,
											profileImage: user.profileImage,
											coverPhoto: user.coverPhoto,
											dob: user.dob,
											city: user.city,
											country: user.country,
											aboutMe: user.aboutMe,
											friends: user.friends,
											pages: user.pages,
											notifications: user.notifications,
											groups: user.groups,
											profileViewers: user.profileViewers,
											profileLocked: user.profileLocked
										}
									});
									return
								});
							}  else {
								result.json({
									"status": "error",
									"message": "Kindly verify your email."
								});
								return
							}
							
						} else {
							result.json({
								"status": "error",
								"message": "Password is not correct"
							});
							return
						}
					});
				}
			});
		});

		app.post("/fetchUserWithNewsfeed", async function (request, result) {
			const accessToken = request.fields.accessToken
			const username = request.fields.username

			const me = await database.collection("users").findOne({
				accessToken: accessToken
			})

			if (me == null) {
				result.json({
					status: "error",
					message: "User has been logged out."
				})

				return
			}

			const user = await database.collection("users").findOne({
				$or: [{
					username: username
				}, {
					_id: username
				}]
			})

			if (user == null) {
				result.json({
					status: "error",
					message: "User not found."
				})

				return
			}

			user.profileLocked = await functions.isProfileLocked(me, user)

			const userObj = {
				name: user.name,
				profileLocked: (user.profileLocked == "yes")
			}
			let newsFeed = []

			if (user.profileLocked == "no") {
				userObj.email = user.email

				userObj.dob = user.dob
				userObj.city = user.city
				userObj.country = user.country
				userObj.aboutMe = user.aboutMe
				userObj.coverPhoto = user.coverPhoto != "" ? (mainURL + "/" + user.coverPhoto) : user.coverPhoto
				userObj.profileImage = user.profileImage != "" ? (mainURL + "/" + user.profileImage) : user.profileImage
				userObj.friends = user.friends.length

				newsFeed = await database.collection("posts")
		            .find({
		                "user._id": user._id
		            })
		            .sort({
		                "createdAt": -1
		            })
		            .limit(5)
		            .toArray()
			}

			result.json({
				status: "success",
				message: "Data has been fetched.",
				user: userObj,
				newsFeed: newsFeed
			})
		})

		app.post("/fetchUser", async function (request, result) {
			const accessToken = request.fields.accessToken
			const username = request.fields.username

			const me = await database.collection("users").findOne({
				accessToken: accessToken
			})

			if (me == null) {
				result.json({
					status: "error",
					message: "User has been logged out."
				})

				return
			}

			const user = await database.collection("users").findOne({
				$or: [{
					username: username
				}, {
					_id: username
				}]
			})

			if (user == null) {
				result.json({
					status: "error",
					message: "User not found."
				})

				return
			}

			user.profileLocked = await functions.isProfileLocked(me, user)

			const userObj = {
				name: user.name,
				profileLocked: (user.profileLocked == "yes")
			}

			if (user.profileLocked == "no") {
				userObj.email = user.email

				userObj.dob = user.dob
				userObj.city = user.city
				userObj.country = user.country
				userObj.aboutMe = user.aboutMe
				userObj.coverPhoto = user.coverPhoto != "" ? (mainURL + "/" + user.coverPhoto) : user.coverPhoto
				userObj.profileImage = user.profileImage != "" ? (mainURL + "/" + user.profileImage) : user.profileImage
				userObj.friends = user.friends.length
			}

			result.json({
				status: "success",
				message: "Data has been fetched.",
				user: userObj
			})
		})

		app.get("/user/:username", async function (request, result) {
			result.render("userProfile", {
				"username": request.params.username
			})
		})

		app.get("/updateProfile", function (request, result) {
			result.render("updateProfile")
		})

		app.post("/getUser", async function (request, result) {
			const accessToken = request.fields.accessToken
			
			const user = await database.collection("users").findOne({
				accessToken: accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return
			}

			user.profileViewers = await database.collection("profile_viewers").find({
				"profile._id": user._id
			}).toArray()

			user.pages = await database.collection("pages").find({
				"user._id": user._id
			}).toArray()

			for (const d of user.pages) {
				if (d.coverPhoto != "") {
					d.coverPhoto = mainURL + "/" + d.coverPhoto
				}

				for (const l of d.likers) {
					if (l.profileImage != "") {
						l.profileImage = mainURL + "/" + l.profileImage
					}
				}
			}

			let hasLocationExpired = true
			if (typeof user.location !== "undefined") {
				const currentTimestamp = new Date().setDate(new Date().getDate() + 1)
				if (currentTimestamp > user.location.createdAt) {
					hasLocationExpired = false
				}
			}

			if (hasLocationExpired) {
				requestModule.post("http://www.geoplugin.net/json.gp", {
	                formData: null
	            }, async function(err, res, data) {
	                if (!err && res.statusCode === 200) {
	                    // console.log(data)

	                    data = JSON.parse(data)

	                    const city = data.geoplugin_city
						const continent = data.geoplugin_continentName
						const country = data.geoplugin_countryName
						const currencyConverter = data.geoplugin_currencyConverter
						const latitude = parseFloat(data.geoplugin_latitude)
						const longitude = parseFloat(data.geoplugin_longitude)
						const region = data.geoplugin_region
						const ipAddress = data.geoplugin_request
						const timezone = data.geoplugin_timezone

						const locationObj = {
							city: city,
							continent: continent,
							country: country,
							currencyConverter: currencyConverter,
							latitude: latitude,
							longitude: longitude,
							region: region,
							ipAddress: ipAddress,
							timezone: timezone,
							createdAt: new Date().getTime()
						}

						await database.collection("users").findOneAndUpdate({
							_id: user._id
						}, {
							$set: {
								location: locationObj
							}
						})
	                }
	            })
			}

			if (typeof user.profileLocked === "undefined") {
				user.profileLocked = "no"
			}

			result.json({
				"status": "success",
				"message": "Record has been fetched.",
				"data": {
					_id: user._id,
					name: user.name,
					username: user.username,
					email: user.email,
					gender: user.gender,
					profileImage: user.profileImage,
					coverPhoto: user.coverPhoto,
					dob: user.dob,
					city: user.city,
					country: user.country,
					aboutMe: user.aboutMe,
					friends: user.friends,
					pages: user.pages,
					notifications: user.notifications,
					groups: user.groups,
					profileViewers: user.profileViewers,
					profileLocked: user.profileLocked
				}
			})
		})

		app.post("/logout", async function (request, result) {
			const accessToken = request.fields.accessToken
			
			const user = await database.collection("users").findOne({
				accessToken: accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User not found."
				})

				return
			}

			await database.collection("users").findOneAndUpdate({
				_id: user._id
			}, {
				$unset: {
					accessToken: 1
				}
			})

			result.json({
				"status": "success",
				"message": "User has been logged out. Please login again."
			})

			return
		})

		app.get("/logout", function (request, result) {
			result.redirect("/login");
		});

		app.post("/uploadCoverPhoto", function (request, result) {
			var accessToken = request.fields.accessToken;
			var coverPhoto = "";

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					if (request.files.coverPhoto.size > 0 && request.files.coverPhoto.type.includes("image")) {

						if (user.coverPhoto != "") {
							fileSystem.unlink(user.coverPhoto, function (error) {
								//
							});
						}

						coverPhoto = "uploads/covers/" + new Date().getTime() + "-" + request.files.coverPhoto.name;

						// Read the file
	                    fileSystem.readFile(request.files.coverPhoto.path, function (err, data) {
	                        if (err) throw err;
	                        console.log('File read!');

	                        // Write the file
	                        fileSystem.writeFile(coverPhoto, data, function (err) {
	                            if (err) throw err;
	                            console.log('File written!');

	                            database.collection("users").updateOne({
									"accessToken": accessToken
								}, {
									$set: {
										"coverPhoto": coverPhoto
									}
								}, function (error, data) {
									result.json({
										"status": "success",
										"message": "Cover photo has been updated.",
										data: mainURL + "/" + coverPhoto
									});
								});
	                        });

	                        // Delete the file
	                        fileSystem.unlink(request.files.coverPhoto.path, function (err) {
	                            if (err) throw err;
	                            console.log('File deleted!');
	                        });
	                    });
						
					} else {
						result.json({
							"status": "error",
							"message": "Please select valid image."
						});
					}
				}
			});
		});

		app.post("/uploadProfileImage", function (request, result) {
			var accessToken = request.fields.accessToken;
			var profileImage = "";

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					if (request.files.profileImage.size > 0 && request.files.profileImage.type.includes("image")) {

						if (user.profileImage != "") {
							fileSystem.unlink(user.profileImage, function (error) {
								// console.log("error deleting file: " + error);
							});
						}

						profileImage = "uploads/profiles/" + new Date().getTime() + "-" + request.files.profileImage.name;

						// Read the file
	                    fileSystem.readFile(request.files.profileImage.path, function (err, data) {
	                        if (err) throw err;
	                        console.log('File read!');

	                        // Write the file
	                        fileSystem.writeFile(profileImage, data, function (err) {
	                            if (err) throw err;
	                            console.log('File written!');

	                            database.collection("users").updateOne({
									"accessToken": accessToken
								}, {
									$set: {
										"profileImage": profileImage
									}
								}, async function (error, data) {

									await functions.updateUser(user, profileImage, user.name);

									result.json({
										"status": "success",
										"message": "Profile image has been updated.",
										data: mainURL + "/" + profileImage
									});
								});
	                        });

	                        // Delete the file
	                        fileSystem.unlink(request.files.profileImage.path, function (err) {
	                            if (err) throw err;
	                            console.log('File deleted!');
	                        });
	                    });

					} else {
						result.json({
							"status": "error",
							"message": "Please select valid image."
						});
					}
				}
			});
		});

		app.post("/updateProfile", function (request, result) {
			var accessToken = request.fields.accessToken;
			var name = request.fields.name;
			var dob = request.fields.dob;
			var city = request.fields.city;
			var country = request.fields.country;
			var aboutMe = request.fields.aboutMe;
			const profileLocked = request.fields.profileLocked || "no"

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					database.collection("users").updateOne({
						"accessToken": accessToken
					}, {
						$set: {
							"name": name,
							"dob": dob,
							"city": city,
							"country": country,
							"aboutMe": aboutMe,
							profileLocked: profileLocked
						}
					}, async function (error, data) {

						await functions.updateUser(user, user.profileImage, name);

						result.json({
							"status": "success",
							"message": "Profile has been updated."
						});
					});
				}
			});
		});

		app.post("/fetchPost", async function (request, result) {
			const _id = request.fields._id ?? ""

			if (!ObjectId.isValid(_id)) {
				result.json({
					status: "error",
					message: "Invalid Object ID."
				})
				return
			}

			const post = await database.collection("posts")
				.findOne({
					_id: ObjectId(_id)
				})

			if (post == null) {
				result.json({
					status: "error",
					message: "Post not found."
				})
				return
			}

			result.json({
				status: "success",
				message: "Post has been fetched.",
				post: post
			})
			return
		})

		app.get("/post/:id", function (request, result) {
			database.collection("posts").findOne({
				"_id": ObjectId(request.params.id)
			}, function (error, post) {
				if (post == null) {
					result.render("errors/404", {
						"message": "This post does not exist anymore."
					});
				} else {
					result.render("postDetail", {
						"post": post
					});
				}
			});
		});

		app.get("/", function (request, result) {
			result.render("index")
		})

		app.post("/addPost", function (request, result) {
			addPost.execute(request, result);
		});

        app.post("/getUserFeed", async function (request, result) {
            var username = request.fields.username;
            var accessToken = request.fields.accessToken;

            var profile = await database.collection("users").findOne({
                "username": username
            });
            if (profile == null) {
                result.json({
                    "status": "error",
                    "message": "User does not exist."
                });
                return;
            }

            var me = await database.collection("users").findOne({
                "accessToken": accessToken
            });
            if (me == null) {
                result.json({
                    "status": "error",
                    "message": "Sorry, you have been logged out."
                });
                return;
            }

            profile.profileLocked = await functions.isProfileLocked(me, profile)

            if (profile.profileLocked == "yes") {
            	result.json({
	                "status": "success",
	                "message": "Record has been fetched",
	                "data": []
	            })

	            return
            }

            /* add or update the profile views counter */
            if (me.username != username) {
                var hasViewed = await database.collection("profile_viewers").findOne({
                    $and: [{
                        "profile._id": profile._id
                    }, {
                        "user._id": me._id
                    }]
                });
                if (hasViewed == null) {
                    /* insert the view. */
                    /* username is saved so the other person can visit his profile. */
                    await database.collection("profile_viewers").insertOne({
                        "profile": {
                            "_id": profile._id,
                            "name": profile.name,
                            "username": profile.username,
                            "profileImage": profile.profileImage
                        },
                        "user": {
                            "_id": me._id,
                            "name": me.name,
                            "username": me.username,
                            "profileImage": me.profileImage
                        },
                        "views": 1,
                        "viewed_at": new Date().getTime()
                    });
                } else {
                    /* increment the counter and time */
                    await database.collection("profile_viewers").updateOne({
                        "_id": hasViewed._id
                    }, {
                        $inc: {
                            "views": 1
                        },
                        $set: {
                            "viewed_at": new Date().getTime()
                        }
                    });
                }
            }

            database.collection("posts")
	            .find({
	                "user._id": profile._id
	            })
	            .sort({
	                "createdAt": -1
	            })
	            .limit(5)
	            .toArray(function (error, data) {
	                result.json({
	                    "status": "success",
	                    "message": "Record has been fetched",
	                    "data": data
	                });
	            });
        });

        app.get("/profileViews", function (request, result) {
        	result.render("profileViews");
        });

		app.post("/getNewsfeed", async function (request, result) {
			var accessToken = request.fields.accessToken

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})
				return false
			}

			var ids = []
			ids.push(user._id)

			for (var a = 0; a < user.pages.length; a++) {
				ids.push(user.pages[a]._id);
			}

			for (var a = 0; a < user.groups.length; a++) {
				if (user.groups[a].status == "Accepted") {
					ids.push(user.groups[a]._id);
				}
			}

			for (var a = 0; a < user.friends.length; a++) {
                if (user.friends[a].status == "Accepted") {
					ids.push(user.friends[a]._id);
                }
			}

			const advertisements = await database.collection("advertisements").find({
				$and: [{
					whereToShow: "newsfeed"
				}, {
					status: "active"
				}, {
					$or: [{
						gender: "both"
					}, {
						gender: user.gender
					}]
				}]
			}).toArray()

			const postIds = []
			for (let a = 0; a < advertisements.length; a++) {
				postIds.push(advertisements[a].post._id)
			}

			let data = await database.collection("posts")
				.find({
					$or: [{
						"user._id": {
							$in: ids
						}
					}, {
						$and: [{
							_id: {
								$in: postIds
							}
						}, {
							isBoost: true
						}]
					}]
				})
				.sort({
					"createdAt": -1
				})
				.limit(5)
				.toArray()

			// data = data.sort(function (a, b) {
			// 	return 0.5 - Math.random()
			// })

			result.json({
				"status": "success",
				"message": "Record has been fetched",
				"data": data
			})
		})

		app.post("/toggleDislikeStory", async function (request, result) {

			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return false
			}

			const post = await database.collection("stories").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Story does not exist."
				})

				return
			}

			var isDisliked = false;
			const dislikers = post.dislikers || []
			for (var a = 0; a < dislikers.length; a++) {
				var disliker = dislikers[a];

				if (disliker._id.toString() == user._id.toString()) {
					isDisliked = true;
					break
				}
			}

			if (isDisliked) {
				await database.collection("stories").updateOne({
					"_id": ObjectId(_id)
				}, {
					$pull: {
						"dislikers": {
							"_id": user._id,
						}
					}
				})

				result.json({
					"status": "undisliked",
					"message": "Story has been un-disliked."
				})

				return
			}

			await database.collection("stories").updateOne({
				"_id": ObjectId(_id)
			}, {
				$push: {
					"dislikers": {
						"_id": user._id,
						"name": user.name,
						"username": user.username,
						"profileImage": user.profileImage,
						"createdAt": new Date().getTime()
					}
				}
			})

			result.json({
				"status": "success",
				"message": "Story has been disliked."
			})
		})

		app.post("/toggleDislikePost", async function (request, result) {

			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return false
			}

			const post = await database.collection("posts").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Post does not exist."
				})

				return
			}

			var isDisliked = false;
			const dislikers = post.dislikers || []
			for (var a = 0; a < dislikers.length; a++) {
				var disliker = dislikers[a];

				if (disliker._id.toString() == user._id.toString()) {
					isDisliked = true;
					break
				}
			}

			if (isDisliked) {
				await database.collection("posts").updateOne({
					"_id": ObjectId(_id)
				}, {
					$pull: {
						"dislikers": {
							"_id": user._id,
						}
					}
				})

				result.json({
					"status": "undisliked",
					"message": "Post has been un-disliked."
				})

				return
			}

			const obj = {
				"_id": user._id,
				"name": user.name,
				"username": user.username,
				"profileImage": user.profileImage,
				"createdAt": new Date().getTime()
			}

			await database.collection("posts").updateOne({
				"_id": ObjectId(_id)
			}, {
				$push: {
					"dislikers": obj
				}
			})

			if (user._id.toString() != post.user._id.toString()) {
				if (post.type == "page_post") {
					const page = await database.collection("pages").findOne({
		                _id: post.user._id
		            })

		            if (page != null) {
		            	await database.collection("users").updateOne({
							_id: page.user._id
						}, {
							$push: {
								notifications: {
									_id: ObjectId(),
									type: "post_disliked",
									content: user.name + " has dis-liked your post.",
									profileImage: user.profileImage,
									isRead: false,
									post: {
										_id: post._id
									},
									createdAt: new Date().getTime()
								}
							}
						})
		            }
				} else if (post.type == "group_post") {
					await database.collection("users").updateOne({
						"_id": post.uploader._id
					}, {
						$push: {
							"notifications": {
								"_id": ObjectId(),
								"type": "post_disliked",
								"content": user.name + " has dis-liked your post.",
								"profileImage": user.profileImage,
								"isRead": false,
								"post": {
									"_id": post._id
								},
								"createdAt": new Date().getTime()
							}
						}
					})
				} else if (post.type == "post") {
					await database.collection("users").updateOne({
						"_id": post.user._id
					}, {
						$push: {
							"notifications": {
								"_id": ObjectId(),
								"type": "post_disliked",
								"content": user.name + " has dis-liked your post.",
								"profileImage": user.profileImage,
								"isRead": false,
								"post": {
									"_id": post._id
								},
								"createdAt": new Date().getTime()
							}
						}
					})
				}
			}

			result.json({
				"status": "success",
				"message": "Post has been disliked.",
				obj: obj
			})
		})

		app.post("/toggleLikeStory", async function (request, result) {

			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return false
			}

			const post = await database.collection("stories").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Story does not exist."
				})

				return
			}

			var isLiked = false;
			const likers = post.likers || []
			for (var a = 0; a < likers.length; a++) {
				var liker = likers[a];

				if (liker._id.toString() == user._id.toString()) {
					isLiked = true;
					break;
				}
			}

			if (isLiked) {
				await database.collection("stories").updateOne({
					"_id": ObjectId(_id)
				}, {
					$pull: {
						"likers": {
							"_id": user._id,
						}
					}
				})

				result.json({
					"status": "unliked",
					"message": "Story has been unliked."
				})

				return
			}

			await database.collection("users").updateOne({
				"_id": post.user._id
			}, {
				$push: {
					"notifications": {
						"_id": ObjectId(),
						"type": "story_liked",
						"content": user.name + " has liked your story.",
						"profileImage": user.profileImage,
						"isRead": false,
						"story": {
							"_id": post._id
						},
						"createdAt": new Date().getTime()
					}
				}
			})

			await database.collection("stories").updateOne({
				"_id": ObjectId(_id)
			}, {
				$push: {
					"likers": {
						"_id": user._id,
						"name": user.name,
						"username": user.username,
						"profileImage": user.profileImage,
						"createdAt": new Date().getTime()
					}
				}
			})

			result.json({
				"status": "success",
				"message": "Story has been liked."
			})
		})

		app.post("/toggleLikePost", async function (request, result) {

			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return false
			}

			const post = await database.collection("posts").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Post does not exist."
				})

				return
			}

			var isLiked = false;
			const likers = post.likers || []
			for (var a = 0; a < likers.length; a++) {
				var liker = likers[a];

				if (liker._id.toString() == user._id.toString()) {
					isLiked = true;
					break;
				}
			}

			if (isLiked) {
				await database.collection("posts").updateOne({
					"_id": ObjectId(_id)
				}, {
					$pull: {
						"likers": {
							"_id": user._id,
						}
					}
				})

				result.json({
					"status": "unliked",
					"message": "Post has been unliked."
				})

				return
			}

			if (user._id.toString() != post.user._id.toString()) {
				if (post.type == "page_post") {
					const page = await database.collection("pages").findOne({
		                _id: post.user._id
		            })

		            if (page != null) {
		            	await database.collection("users").updateOne({
							_id: page.user._id
						}, {
							$push: {
								notifications: {
									_id: ObjectId(),
									type: "post_liked",
									content: user.name + " has liked your post.",
									profileImage: user.profileImage,
									isRead: false,
									post: {
										_id: post._id
									},
									createdAt: new Date().getTime()
								}
							}
						})
		            }
				} else if (post.type == "group_post") {
					await database.collection("users").updateOne({
						"_id": post.uploader._id
					}, {
						$push: {
							"notifications": {
								"_id": ObjectId(),
								"type": "post_liked",
								"content": user.name + " has liked your post.",
								"profileImage": user.profileImage,
								"isRead": false,
								"post": {
									"_id": post._id
								},
								"createdAt": new Date().getTime()
							}
						}
					})
				} else if (post.type == "post") {
					await database.collection("users").updateOne({
						"_id": post.user._id
					}, {
						$push: {
							"notifications": {
								"_id": ObjectId(),
								"type": "post_liked",
								"content": user.name + " has liked your post.",
								"profileImage": user.profileImage,
								"isRead": false,
								"post": {
									"_id": post._id
								},
								"createdAt": new Date().getTime()
							}
						}
					})
				}
			}

			const obj = {
				"_id": user._id,
				"name": user.name,
				"username": user.username,
				"profileImage": user.profileImage,
				"createdAt": new Date().getTime()
			}

			await database.collection("posts").updateOne({
				"_id": ObjectId(_id)
			}, {
				$push: {
					"likers": obj
				}
			})

			result.json({
				"status": "success",
				"message": "Post has been liked.",
				obj: obj
			})
		})

		app.post("/fetchCommentsByStory", async function (request, result) {
			const accessToken = request.fields.accessToken
			const _id = request.fields._id

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return
			}

			const post = await database.collection("stories").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Story does not exist."
				})

				return
			}

			if (post.user._id.toString() != user._id.toString()) {
				result.json({
					"status": "error",
					"message": "Unauthorized."
				})

				return
			}

			let comments = post.comments
			comments = comments.reverse()

			result.json({
				status: "success",
				message: "Data has been fetched.",
				comments: comments
			})
		})

		app.post("/fetchCommentsByPost", async function (request, result) {
			const accessToken = request.fields.accessToken
			const _id = request.fields._id

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return
			}

			const post = await database.collection("posts").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Post does not exist."
				})

				return
			}

			let comments = post.comments
			comments = comments.reverse()

			for (const obj of comments) {
				if (obj.user.profileImage != "") {
					obj.user.profileImage = mainURL + "/" + obj.user.profileImage
				}
			}

			result.json({
				status: "success",
				message: "Data has been fetched.",
				comments: comments
			})
		})

		app.post("/postCommentOnStory", async function (request, result) {
			var accessToken = request.fields.accessToken
			var _id = request.fields._id
			var comment = request.fields.comment
			var createdAt = new Date().getTime()

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return
			}

			const post = await database.collection("stories").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Story does not exist."
				})

				return
			}

			var commentId = ObjectId()
			const commentObj = {
				"_id": commentId,
				"user": {
					"_id": user._id,
					"name": user.name,
					"profileImage": user.profileImage,
				},
				"comment": comment,
				"createdAt": createdAt,
				"replies": []
			}

			await database.collection("stories").updateOne({
				"_id": ObjectId(_id)
			}, {
				$push: {
					"comments": commentObj
				}
			})

			if (user._id.toString() != post.user._id.toString()) {
				await database.collection("users").updateOne({
					"_id": post.user._id
				}, {
					$push: {
						"notifications": {
							"_id": ObjectId(),
							"type": "new_comment_on_story",
							"content": user.name + " commented on your story.",
							"profileImage": user.profileImage,
							"story": {
								"_id": post._id
							},
							"isRead": false,
							"createdAt": new Date().getTime()
						}
					}
				})
			}

			const updatePost = await database.collection("stories").findOne({
				"_id": ObjectId(_id)
			})

			if (updatePost == null) {
				result.json({
					"status": "success",
					"message": "Story does not exists."
				})

				return
			}

			socketIO.emit("commentPostedOnStory", {
				story: updatePost,
				comment: commentObj
			})

			result.json({
				"status": "success",
				"message": "Comment has been posted.",
				"updatePost": updatePost
			})
		})

		app.post("/postComment", async function (request, result) {
			var accessToken = request.fields.accessToken
			var _id = request.fields._id
			var comment = request.fields.comment
			var createdAt = new Date().getTime()

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return
			}

			const post = await database.collection("posts").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Post does not exist."
				})

				return
			}

			var commentId = ObjectId()
			const commentObj = {
				"_id": commentId,
				"user": {
					"_id": user._id,
					"name": user.name,
					"profileImage": user.profileImage,
				},
				"comment": comment,
				"createdAt": createdAt,
				"replies": []
			}

			await database.collection("posts").updateOne({
				"_id": ObjectId(_id)
			}, {
				$push: {
					"comments": commentObj
				}
			})

			if (user._id.toString() != post.user._id.toString()) {
				if (post.type == "page_post") {
					const page = await database.collection("pages").findOne({
		                _id: post.user._id
		            })

		            if (page != null) {
		            	await database.collection("users").updateOne({
							_id: page.user._id
						}, {
							$push: {
								notifications: {
									_id: ObjectId(),
									type: "new_comment",
									content: user.name + " commented on your post.",
									profileImage: user.profileImage,
									isRead: false,
									post: {
										_id: post._id
									},
									createdAt: new Date().getTime()
								}
							}
						})
		            }
				} else if (post.type == "group_post") {
					await database.collection("users").updateOne({
						"_id": post.uploader._id
					}, {
						$push: {
							"notifications": {
								"_id": ObjectId(),
								"type": "new_comment",
								"content": user.name + " commented on your post.",
								"profileImage": user.profileImage,
								"post": {
									"_id": post._id
								},
								"isRead": false,
								"createdAt": new Date().getTime()
							}
						}
					})
				} else if (post.type == "post") {
					await database.collection("users").updateOne({
						"_id": post.user._id
					}, {
						$push: {
							"notifications": {
								"_id": ObjectId(),
								"type": "new_comment",
								"content": user.name + " commented on your post.",
								"profileImage": user.profileImage,
								"post": {
									"_id": post._id
								},
								"isRead": false,
								"createdAt": new Date().getTime()
							}
						}
					})
				}
			}

			const updatePost = await database.collection("posts").findOne({
				"_id": ObjectId(_id)
			})

			if (updatePost == null) {
				result.json({
					"status": "success",
					"message": "Post does not exists."
				})

				return
			}

			socketIO.emit("commentPosted", {
				post: updatePost,
				comment: commentObj
			})

			for (const obj of updatePost.comments) {
				if (obj.user.profileImage != "") {
					obj.user.profileImage = mainURL + "/" + obj.user.profileImage
				}
			}

			result.json({
				"status": "success",
				"message": "Comment has been posted.",
				"updatePost": updatePost
			})
		})

		app.post("/postReply", function (request, result) {

			var accessToken = request.fields.accessToken;
			var postId = request.fields.postId;
			var commentId = request.fields.commentId;
			var reply = request.fields.reply;
			var createdAt = new Date().getTime();

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					database.collection("posts").findOne({
						"_id": ObjectId(postId)
					}, function (error, post) {
						if (post == null) {
							result.json({
								"status": "error",
								"message": "Post does not exist."
							});
						} else {

							var replyId = ObjectId()
							const replyObj = {
								"_id": replyId,
								"user": {
									"_id": user._id,
									"name": user.name,
									"profileImage": user.profileImage,
								},
								"reply": reply,
								"createdAt": createdAt
							}

							database.collection("posts").updateOne({
								$and: [{
									"_id": ObjectId(postId)
								}, {
									"comments._id": ObjectId(commentId)
								}]
							}, {
								$push: {
									"comments.$.replies": replyObj
								}
							}, function (error, data) {

								database.collection("users").updateOne({
									$and: [{
										"_id": post.user._id
									}, {
										"posts._id": post._id
									}, {
										"posts.comments._id": ObjectId(commentId)
									}]
								}, {
									$push: {
										"posts.$[].comments.$[].replies": replyObj
									}
								});

								database.collection("posts").findOne({
									"_id": ObjectId(postId)
								}, function (error, updatePost) {

									socketIO.emit("postReply", {
										post: updatePost,
										reply: replyObj,
										commentId: commentId
									})

									result.json({
										"status": "success",
										"message": "Reply has been posted.",
										"updatePost": updatePost,
										replyObj: replyObj
									});
								});
							});

						}
					});
				}
			});
		});

		app.get("/search/:query", function (request, result) {
			var query = request.params.query
			result.render("search", {
				"query": query
			})
		})

		app.post("/search", async function (request, result) {
			const query = request.fields.query

			const users = await database.collection("users").find({
				$or: [{
					"name": {
						$regex: ".*" + query + ".*",
						$options: "i"
					}
				}, {
					"username": {
						$regex: ".*" + query + ".*",
						$options: "i"
					}
				}, {
					"email": {
						$regex: ".*" + query + ".*",
						$options: "i"
					}
				}]
			}).toArray()

			const usersData = []
			for (const u of users) {
				if (u.profileImage != "") {
					u.profileImage = mainURL + "/" + u.profileImage
				}
				usersData.push({
					_id: u._id,
					profileImage: u.profileImage,
					username: u.username,
					name: u.name
				})
			}

			const pages = await database.collection("pages").find({
				"name": {
					$regex: ".*" + query + ".*",
					$options: "i"
				}
			}).toArray()

			const pagesData = []
			for (const p of pages) {
				if (p.coverPhoto != "") {
					p.coverPhoto = mainURL + "/" + p.coverPhoto
				}
				pagesData.push({
					_id: p._id,
					coverPhoto: p.coverPhoto,
					name: p.name,
					likers: p.likers || []
				})
			}

			const groups = await database.collection("groups").find({
				"name": {
					$regex: ".*" + query + ".*",
					$options: "i"
				}
			}).toArray()

			const groupsData = []
			for (const g of groups) {
				if (g.coverPhoto != "") {
					g.coverPhoto = mainURL + "/" + g.coverPhoto
				}
				groupsData.push({
					_id: g._id,
					coverPhoto: g.coverPhoto,
					name: g.name,
					members: g.members || []
				})
			}

			const events = await database.collection("events").find({
				"name": {
					$regex: ".*" + query + ".*",
					$options: "i"
				}
			}).sort({
				"eventDate": -1
			}).toArray()

			const eventsData = []
			for (const e of events) {
				if (e.image != "") {
					e.image = mainURL + "/" + e.image
				}
				eventsData.push({
					_id: e._id,
					image: e.image,
					name: e.name,
					going: e.going
				})
			}

			result.json({
				status: "success",
				message: "Record has been fetched",
				users: usersData,
				pages: pagesData,
				groups: groupsData,
				events: eventsData
			})
		})

		app.post("/sendFriendRequest", function (request, result) {

			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					var me = user;
					database.collection("users").findOne({
						"_id": ObjectId(_id)
					}, function (error, user) {
						if (user == null) {
							result.json({
								"status": "error",
								"message": "User does not exist."
							});
						} else {

                            if (_id.toString() == me._id.toString()) {
                                result.json({
                                    "status": "error",
                                    "message": "You cannot send a friend request to yourself."
                                });
                                return;
                            }

                            database.collection("users").findOne({
                                $and: [{
                                    "_id": ObjectId(_id)
                                }, {
                                    "friends._id": me._id
                                }]
                            }, function (error, isExists) {
                                if (isExists) {
                                    result.json({
                                        "status": "error",
                                        "message": "Friend request already sent."
                                    });
                                } else {
                                    database.collection("users").updateOne({
                                        "_id": ObjectId(_id)
                                    }, {
                                        $push: {
                                            "friends": {
                                                "_id": me._id,
                                                "name": me.name,
                                                "username": me.username,
                                                "profileImage": me.profileImage,
                                                "status": "Pending",
                                                "sentByMe": false,
                                                "inbox": []
                                            }
                                        }
                                    }, function (error, data) {

                                    	const friendObj = {
                                            "_id": user._id,
                                            "name": user.name,
                                            "username": user.username,
                                            "profileImage": user.profileImage,
                                            "status": "Pending",
                                            "sentByMe": true,
                                            "inbox": []
                                        }

                                        database.collection("users").updateOne({
                                            "_id": me._id
                                        }, {
                                            $push: {
                                                "friends": friendObj
                                            }
                                        }, function (error, data) {

                                            result.json({
                                                "status": "success",
                                                "message": "Friend request has been sent.",
                                                friend: friendObj
                                            });

                                        });

                                    });
                                }
                            });
						}
					});
				}
			});
		});

		app.get("/friends", function (request, result) {
			result.render("friends");
		});

		app.post("/acceptFriendRequest", function (request, result) {

			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					var me = user;
					database.collection("users").findOne({
						"_id": ObjectId(_id)
					}, function (error, user) {
						if (user == null) {
							result.json({
								"status": "error",
								"message": "User does not exist."
							});
						} else {

                            for (var a = 0; a < me.friends.length; a++) {
                                if (me.friends[a]._id.toString() == _id.toString()
                                    && me.friends[a].status == "Accepted") {
                                    result.json({
                                        "status": "error",
                                        "message": "Friend request already accepted."
                                    });
                                    return;
                                }
                            }

							database.collection("users").updateOne({
								"_id": ObjectId(_id)
							}, {
								$push: {
									"notifications": {
										"_id": ObjectId(),
										"type": "friend_request_accepted",
										"content": me.name + " accepted your friend request.",
										"profileImage": me.profileImage,
										"isRead": false,
										"createdAt": new Date().getTime()
									}
								}
							});

							database.collection("users").updateOne({
								$and: [{
									"_id": ObjectId(_id)
								}, {
									"friends._id": me._id
								}]
							}, {
								$set: {
									"friends.$.status": "Accepted"
								}
							}, function (error, data) {

								database.collection("users").updateOne({
									$and: [{
										"_id": me._id
									}, {
										"friends._id": user._id
									}]
								}, {
									$set: {
										"friends.$.status": "Accepted"
									}
								}, function (error, data) {

									result.json({
										"status": "success",
										"message": "Friend request has been accepted."
									});

								});

							});

						}
					});
				}
			});
		});

		app.post("/unfriend", function (request, result) {

			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					var me = user;
					database.collection("users").findOne({
						"_id": ObjectId(_id)
					}, function (error, user) {
						if (user == null) {
							result.json({
								"status": "error",
								"message": "User does not exist."
							});
						} else {

							database.collection("users").updateOne({
								"_id": ObjectId(_id)
							}, {
								$pull: {
									"friends": {
										"_id": me._id
									}
								}
							}, function (error, data) {

								database.collection("users").updateOne({
									"_id": me._id
								}, {
									$pull: {
										"friends": {
											"_id": user._id
										}
									}
								}, function (error, data) {

									result.json({
										"status": "success",
										"message": "Friend has been removed."
									});

								});

							});

						}
					});
				}
			});
		});

		app.get("/inbox", function (request, result) {
			// result.render("inbox")
			result.render("inbox-new")
		})

		app.post("/getFriendsChat", async function (request, result) {
			var accessToken = request.fields.accessToken;
	        var _id = request.fields._id;

	        var me = await database.collection("users").findOne({
	            "accessToken": accessToken
	        });

	        if (me == null) {
	            result.json({
	                "status": "error",
	                "message": "User has been logged out. Please login again."
	            });

	            return false;
	        }

	        if (me.isBanned) {
	            result.json({
	                "status": "error",
	                "message": "You have been banned."
	            });
	            return false;
	        }

	        const user = await database.collection("users").findOne({
	            _id: ObjectId(_id)
	        })

	        if (user == null) {
	            result.json({
	                "status": "error",
	                "message": "User does not exists."
	            })

	            return
	        }

	        var index = me.friends.findIndex(function(friend) {
	            return friend._id == _id
	        });
	        var inbox = me.friends[index].inbox;

	        // updating logged in user's record
	        await database.collection("users").updateOne({
	            $and: [{
	                "accessToken": accessToken
	            }, {
	                "friends._id": user._id
	            }]
	        }, {
	            $set: {
	                "friends.$.inbox.$[].is_read": true,
	                "friends.$.unread": 0
	            }
	        });

	        for (var a = 0; a < inbox.length; a++) {
	            if (inbox[a].message != null) {
	                // inbox[a].message = this.cryptr.decrypt(inbox[a].message)
	            }
	        }

	        result.json({
	            "status": "success",
	            "message": "Record has been fetched",
	            "data": inbox,
	            privateKey: JSON.parse(me.privateKey),
	            publicKey: JSON.parse(user.publicKey)
	        });
		});

		app.post("/sendMessage", async function (request, result) {
			// chat.sendMessage(request, result)

			const accessToken = request.fields.accessToken
			const _id = request.fields._id
			const message = request.fields.message
			const messageEncrypted = request.fields.messageEncrypted || ""
			const iv = request.fields.iv || ""

			const me = await database.collection("users").findOne({
	            accessToken: request.fields.accessToken
	        })

	        if (me == null) {
	            result.json({
	                status: "error",
	                message: "User has been logged out. Please login again."
	            })

	            return
	        }

	        const user = await database.collection("users").findOne({
	            _id: ObjectId(_id)
	        })

	        if (user == null) {
	            result.json({
	                status: "error",
	                message: "User does not exist."
	            })

	            return
	        }

	        if (filter.isProfane(message)) {
	            result.json({
	                status: "error",
	                message: "Your message contains abusive or offensive language."
	            })

	            return
	        }

	        var messageObj = {
	            _id: ObjectId(),
	            // message: cryptr.encrypt(message),
	            message: messageEncrypted,
	            iv: iv,
	            from: me._id,
	            is_read: false,
	            images: [],
	            videos: [],
	            is_deleted: false,
	            createdAt: new Date().getTime()
	        }

	        const files = []
	        if (Array.isArray(request.files.files)) {
	            for (let a = 0; a < request.files.files.length; a++) {
	            	if (request.files.files[a].size > 0) {
		                files.push(request.files.files[a])
		            }
	            }
	        } else {
	        	if (request.files.files.size > 0) {
		            files.push(request.files.files)
		        }
	        }

	        functions.callbackFileUpload(files, 0, [], async function (savedPaths) {
	        	messageObj.savedPaths = savedPaths
	        	
	        	// Other user's data
		        await database.collection("users").updateOne({
		            $and: [{
		                "_id": user._id
		            }, {
		                "friends._id": me._id
		            }]
		        }, {
		            $push: {
		                "friends.$.inbox": messageObj
		            },
		            $inc: {
		                "friends.$.unread": 1
		            }
		        });

		        messageObj.is_read = true;

		        // logged in user's data
		        await database.collection("users").updateOne({
		            $and: [{
		                "_id": me._id
		            }, {
		                "friends._id": user._id
		            }]
		        }, {
		            $push: {
		                "friends.$.inbox": messageObj
		            }
		        });

		        // messageObj.message = cryptr.decrypt(messageObj.message);
		        socketIO.to(users[user._id]).emit("messageReceived", messageObj)

		        result.json({
		            status: "success",
		            message: "Message has been sent.",
		            data: messageObj
		        })
	        })
		})

		app.post("/connectSocket", function (request, result) {
			var accessToken = request.fields.accessToken;
			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					users[user._id] = socketID;
					result.json({
						"status": "status",
						"message": "Socket has been connected."
					});
				}
			});
		});

		app.get("/createPage", function (request, result) {
			result.render("createPage");
		});

		app.post("/createPage", function (request, result) {

			var accessToken = request.fields.accessToken;
			var name = request.fields.name;
			var domainName = request.fields.domainName;
			var additionalInfo = request.fields.additionalInfo;
			var coverPhoto = "";
            var type = request.fields.type;
            var imageData = request.fields.imageData;

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

                    if (type == "ios") {

                        coverPhoto = "uploads/pages/" + new Date().getTime() + ".jpeg";

                        var base64Data = imageData.replace(/^data:image\/jpeg;base64,/, "");
                        base64Data += base64Data.replace('+', ' ');
                        var binaryData = new Buffer(base64Data, 'base64').toString('binary');
                        fileSystem.writeFile(coverPhoto, binaryData, "binary", function (err) {
                            // console.log(err);
                        });

                        database.collection("pages").insertOne({
                            "name": name,
                            "domainName": domainName,
                            "additionalInfo": additionalInfo,
                            "coverPhoto": coverPhoto,
                            "likers": [],
                            "user": {
                                "_id": user._id,
                                "name": user.name,
                                "profileImage": user.profileImage
                            },
                            createdAt: new Date().toUTCString()
                        }, function (error, data) {

                            result.json({
                                "status": "success",
                                "message": "Page has been created."
                            });

                        });
                    } else {
                        if (request.files.coverPhoto.size > 0 && request.files.coverPhoto.type.includes("image")) {

                            coverPhoto = "uploads/pages/" + new Date().getTime() + "-" + request.files.coverPhoto.name;
                            
                            // Read the file
		                    fileSystem.readFile(request.files.coverPhoto.path, function (err, data) {
		                        if (err) throw err;
		                        console.log('File read!');

		                        // Write the file
		                        fileSystem.writeFile(coverPhoto, data, function (err) {
		                            if (err) throw err;
		                            console.log('File written!');

		                            database.collection("pages").insertOne({
		                                "name": name,
		                                "domainName": domainName,
		                                "additionalInfo": additionalInfo,
		                                "coverPhoto": coverPhoto,
		                                "likers": [],
		                                "user": {
		                                    "_id": user._id,
		                                    "name": user.name,
		                                    "profileImage": user.profileImage
		                                },
		                                createdAt: new Date().toUTCString()
		                            }, function (error, data) {

		                                result.json({
		                                    "status": "success",
		                                    "message": "Page has been created."
		                                });

		                            });
		                        });

		                        // Delete the file
		                        fileSystem.unlink(request.files.coverPhoto.path, function (err) {
		                            if (err) throw err;
		                            console.log('File deleted!');
		                        });
		                    });
                        } else {
                            result.json({
                                "status": "error",
                                "message": "Please select a cover photo."
                            });
                        }
                    }
				}
			});
		});

		app.get("/pages", function (request, result) {
			result.render("pages");
		});

		app.post("/getPages", async function (request, result) {
			var accessToken = request.fields.accessToken

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})
				return false
			}

			const advertisements = await database.collection("advertisements").find({
				$and: [{
					whereToShow: "groups"
				}, {
					status: "active"
				}]
			}).toArray()

			const postIds = []
			for (let a = 0; a < advertisements.length; a++) {
				postIds.push(advertisements[a].post._id)
			}

			const ads = await database.collection("posts")
				.find({
					$and: [{
						_id: {
							$in: postIds
						}
					}, {
						isBoost: true
					}]
				})
				.sort({
					"createdAt": -1
				})
				.limit(5)
				.toArray()

			const data = await database.collection("pages").find({
				$or: [{
					"user._id": user._id
				}, {
					"likers._id": user._id
				}]
			}).toArray()

			for (const d of data) {
				if (d.coverPhoto != "") {
					d.coverPhoto = mainURL + "/" + d.coverPhoto
				}
			}

			result.json({
				"status": "success",
				"message": "Record has been fetched.",
				"data": data,
				ads: ads
			})
		});

		app.get("/page/:_id", function (request, result) {
			var _id = request.params._id;

			database.collection("pages").findOne({
				"_id": ObjectId(_id)
			}, function (error, page) {
				if (page == null) {
					result.json({
						"status": "error",
						"message": "Page does not exist."
					});
				} else {
					result.render("singlePage", {
						"_id": _id
					});
				}
			});
		});

		app.get("/edit-page/:_id", function (request, result) {
			var _id = request.params._id;

			database.collection("pages").findOne({
				"_id": ObjectId(_id)
			}, function (error, page) {
				if (page == null) {
					result.json({
						"status": "error",
						"message": "Page does not exist."
					});
				} else {
					result.render("editPage", {
						"page": page
					});
				}
			});
		});

		app.post("/editPage", function (request, result) {
			page.update(request, result);
		});

		app.post("/deletePage", function (request, result) {
			page.destroy(request, result);
		});

		app.post("/getPageDetail", async function (request, result) {
			var _id = request.fields._id

			const page = await database.collection("pages").findOne({
				"_id": ObjectId(_id)
			})

			if (page == null) {
				result.json({
					"status": "error",
					"message": "Page does not exist."
				})

				return
			}

			let posts = await database.collection("posts").find({
				$and: [{
					"user._id": page._id
				}, {
					"type": "page_post"
				}]
			}).toArray()

			const totalAds = await database.collection("advertisements").find({
				$and: [{
					whereToShow: "pages"
				}, {
					status: "active"
				}]
			}).count()

			const randomAd = Math.floor(Math.random() * totalAds)

			const advertisements = await database.collection("advertisements").find({
				$and: [{
					whereToShow: "pages"
				}, {
					status: "active"
				}]
			})
				.skip(randomAd)
				.toArray()

			const postIds = []
			for (let a = 0; a < advertisements.length; a++) {
				postIds.push(advertisements[a].post._id)
				if (posts.length == 0) {
					break
				}
			}

			const boostedPosts = await database.collection("posts").find({
				$and: [{
					_id: {
						$in: postIds
					}
				}, {
					isBoost: true
				}]
			}).toArray()

			for (let a = 0; a < boostedPosts.length; a++) {
				posts.push(boostedPosts[a])
			}

			posts = posts.sort(function (a, b) {
				return 0.5 - Math.random()
			})

			if (page.coverPhoto != "") {
				page.coverPhoto = mainURL + "/" + page.coverPhoto
			}

			result.json({
				status: "success",
				message: "Record has been fetched.",
				data: page,
				posts: posts
			})
		})

		app.post("/toggleLikePage", function (request, result) {
			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					database.collection("pages").findOne({
						"_id": ObjectId(_id)
					}, function (error, page) {
						if (page == null) {
							result.json({
								"status": "error",
								"message": "Page does not exist."
							});
						} else {

							var isLiked = false;
							for (var a = 0; a < page.likers.length; a++) {
								var liker = page.likers[a];

								if (liker._id.toString() == user._id.toString()) {
									isLiked = true;
									break;
								}
							}

							if (isLiked) {
								database.collection("pages").updateOne({
									"_id": ObjectId(_id)
								}, {
									$pull: {
										"likers": {
											"_id": user._id,
										}
									}
								}, function (error, data) {

									database.collection("users").updateOne({
										"accessToken": accessToken
									}, {
										$pull: {
											"pages": {
												"_id": ObjectId(_id)
											}
										}
									}, function (error, data) {
										result.json({
											"status": "unliked",
											"message": "Page has been unliked."
										});
									});
								});
							} else {

								const likerObj = {
									"_id": user._id,
									"name": user.name,
									"profileImage": user.profileImage
								}

								database.collection("pages").updateOne({
									"_id": ObjectId(_id)
								}, {
									$push: {
										"likers": likerObj
									}
								}, function (error, data) {

									if (likerObj.profileImage != "") {
										likerObj.profileImage = mainURL + "/" + likerObj.profileImage
									}

									database.collection("users").updateOne({
										"accessToken": accessToken
									}, {
										$push: {
											"pages": {
												"_id": page._id,
												"name": page.name,
												"coverPhoto": page.coverPhoto
											}
										}
									}, function (error, data) {
										result.json({
											"status": "success",
											"message": "Page has been liked.",
											obj: likerObj
										});
									});
								});
							}
						}
					});
				}
			});
		});

		app.post("/getMyPages", function (request, result) {
			var accessToken = request.fields.accessToken;

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					database.collection("pages").find({
						"user._id": user._id
					}).toArray(function (error, data) {
						result.json({
							"status": "success",
							"message": "Record has been fetched.",
							"data": data
						});
					});

				}
			});
		});

		app.get("/createGroup", function (request, result) {
			result.render("createGroup");
		});

		app.post("/createGroup", function (request, result) {

			var accessToken = request.fields.accessToken;
			var name = request.fields.name;
			var additionalInfo = request.fields.additionalInfo;
			var coverPhoto = "";
            var type = request.fields.type;
            var imageData = request.fields.imageData;

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

                    if (type == "ios") {

                        coverPhoto = "uploads/groups/" + new Date().getTime() + ".jpeg";

                        var base64Data = imageData.replace(/^data:image\/jpeg;base64,/, "");
                        base64Data += base64Data.replace('+', ' ');
                        var binaryData = new Buffer(base64Data, 'base64').toString('binary');
                        fileSystem.writeFile(coverPhoto, binaryData, "binary", function (err) {
                            // console.log(err);
                        });

                        database.collection("groups").insertOne({
                            "name": name,
                            "additionalInfo": additionalInfo,
                            "coverPhoto": coverPhoto,
                            "members": [{
                                "_id": user._id,
                                "name": user.name,
                                "profileImage": user.profileImage,
                                "status": "Accepted"
                            }],
                            "user": {
                                "_id": user._id,
                                "name": user.name,
                                "profileImage": user.profileImage
                            },
                            createdAt: new Date().toUTCString()
                        }, function (error, data) {

                            database.collection("users").updateOne({
                                "accessToken": accessToken
                            }, {
                                $push: {
                                    "groups": {
                                        "_id": data.insertedId,
                                        "name": name,
                                        "coverPhoto": coverPhoto,
                                        "status": "Accepted"
                                    }
                                }
                            }, function (error, data) {

                                result.json({
                                    "status": "success",
                                    "message": "Group has been created."
                                });
                            });
                        });
                    } else {

    					if (request.files?.coverPhoto.size > 0 && request.files?.coverPhoto.type.includes("image")) {

    						coverPhoto = "uploads/groups/" + new Date().getTime() + "-" + request.files.coverPhoto.name;
    						
    						// Read the file
		                    fileSystem.readFile(request.files.coverPhoto.path, function (err, data) {
		                        if (err) throw err;
		                        console.log('File read!');

		                        // Write the file
		                        fileSystem.writeFile(coverPhoto, data, function (err) {
		                            if (err) throw err;
		                            console.log('File written!');

		                            database.collection("groups").insertOne({
		    							"name": name,
		    							"additionalInfo": additionalInfo,
		    							"coverPhoto": coverPhoto,
		    							"members": [{
		    								"_id": user._id,
		    								"name": user.name,
		    								"profileImage": user.profileImage,
		    								"status": "Accepted"
		    							}],
		    							"user": {
		    								"_id": user._id,
		    								"name": user.name,
		    								"profileImage": user.profileImage
		    							},
		    							createdAt: new Date().toUTCString()
		    						}, function (error, data) {

		    							database.collection("users").updateOne({
		    								"accessToken": accessToken
		    							}, {
		    								$push: {
		    									"groups": {
		    										"_id": data.insertedId,
		    										"name": name,
		    										"coverPhoto": coverPhoto,
		    										"status": "Accepted"
		    									}
		    								}
		    							}, function (error, data) {

		    								result.json({
		    									"status": "success",
		    									"message": "Group has been created."
		    								});
		    							});
		    						});
		                        });

		                        // Delete the file
		                        fileSystem.unlink(request.files.coverPhoto.path, function (err) {
		                            if (err) throw err;
		                            console.log('File deleted!');
		                        });
		                    });
    					} else {
    						result.json({
    							"status": "error",
    							"message": "Please select a cover photo."
    						});
    					}
                    }
				}
			});
		});

		app.get("/groups", function (request, result) {
			result.render("groups");
		});

		app.post("/getGroups", async function (request, result) {
			var accessToken = request.fields.accessToken

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})
			
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return
			}

			const totalAds = await database.collection("advertisements").find({
				$and: [{
					whereToShow: "groups"
				}, {
					status: "active"
				}]
			}).count()

			const randomAd = Math.floor(Math.random() * totalAds)

			const advertisements = await database.collection("advertisements").find({
				$and: [{
					whereToShow: "groups"
				}, {
					status: "active"
				}]
			})
				.skip(randomAd)
				.limit(1)
				.toArray()

			const postIds = []
			for (let a = 0; a < advertisements.length; a++) {
				postIds.push(advertisements[a].post._id)
			}

			const ads = await database.collection("posts")
				.find({
					$and: [{
						_id: {
							$in: postIds
						}
					}, {
						isBoost: true
					}]
				})
				.sort({
					"createdAt": -1
				})
				.toArray()

			const data = await database.collection("groups").find({
				$or: [{
					"user._id": user._id
				}, {
					"members._id": user._id
				}]
			}).toArray()

			for (const d of data) {
				if (d.coverPhoto != "") {
					d.coverPhoto = mainURL + "/" + d.coverPhoto
				}
			}

			result.json({
				"status": "success",
				"message": "Record has been fetched.",
				"data": data,
				ads: ads
			})
		})

		app.get("/group/:_id", function (request, result) {
			var _id = request.params._id;

			database.collection("groups").findOne({
				"_id": ObjectId(_id)
			}, function (error, group) {
				if (group == null) {
					result.json({
						"status": "error",
						"message": "Group does not exist."
					});
				} else {
					result.render("singleGroup", {
						"_id": _id
					});
				}
			});
		});

		app.get("/edit-group/:_id", function (request, result) {
			var _id = request.params._id;

			database.collection("groups").findOne({
				"_id": ObjectId(_id)
			}, function (error, group) {
				if (group == null) {
					result.json({
						"status": "error",
						"message": "Group does not exist."
					});
				} else {
					result.render("editGroup", {
						"group": group
					});
				}
			});
		});

		app.post("/editGroup", function (request, result) {
			group.update(request, result);
		});

		app.post("/deleteGroup", function (request, result) {
			group.destroy(request, result);
		});

		app.post("/getGroupDetail", async function (request, result) {
			var _id = request.fields._id

			const group = await database.collection("groups").findOne({
				"_id": ObjectId(_id)
			})

			if (group == null) {
				result.json({
					"status": "error",
					"message": "Group does not exist."
				})

				return
			}

			let posts = await database.collection("posts").find({
				$and: [{
					"user._id": group._id
				}, {
					"type": "group_post"
				}]
			})
				.sort({
					"createdAt": -1
				})
				.toArray()

			const totalAds = await database.collection("advertisements").find({
				$and: [{
					whereToShow: "groups"
				}, {
					status: "active"
				}]
			}).count()

			const randomAd = Math.floor(Math.random() * totalAds)

			const advertisements = await database.collection("advertisements").find({
				$and: [{
					whereToShow: "groups"
				}, {
					status: "active"
				}]
			})
				.skip(randomAd)
				.toArray()

			const postIds = []
			for (let a = 0; a < advertisements.length; a++) {
				postIds.push(advertisements[a].post._id)
				if (posts.length == 0) {
					break
				}
			}

			const boostedPosts = await database.collection("posts").find({
				$and: [{
					_id: {
						$in: postIds
					}
				}, {
					isBoost: true
				}]
			})
				.sort({
					"createdAt": -1
				})
				.toArray()

			for (let a = 0; a < boostedPosts.length; a++) {
				posts.push(boostedPosts[a])
			}

			posts = posts.sort(function (a, b) {
				return 0.5 - Math.random()
			})

			if (group.coverPhoto != "") {
				group.coverPhoto = mainURL + "/" + group.coverPhoto
			}

			for (const m of group.members) {
				if (m.profileImage != "") {
					m.profileImage = mainURL + "/" + m.profileImage
				}
			}

			if (group.user.profileImage != "") {
				group.user.profileImage = mainURL + "/" + group.user.profileImage
			}

			result.json({
				"status": "success",
				"message": "Record has been fetched.",
				"group": group,
				"data": posts
			})
		})

		app.post("/toggleJoinGroup", function (request, result) {
			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					database.collection("groups").findOne({
						"_id": ObjectId(_id)
					}, function (error, group) {
						if (group == null) {
							result.json({
								"status": "error",
								"message": "Group does not exist."
							});
						} else {

							var isMember = false;
							for (var a = 0; a < group.members.length; a++) {
								var member = group.members[a];

								if (member._id.toString() == user._id.toString()) {
									isMember = true;
									break;
								}
							}

							if (isMember) {
								database.collection("groups").updateOne({
									"_id": ObjectId(_id)}, {
										$pull: {
											"members": {
												"_id": user._id,
											}
										}
									}, function (error, data) {

										database.collection("users").updateOne({
											"accessToken": accessToken}, {
												$pull: {
													"groups": {
														"_id": ObjectId(_id)
													}
												}
											}, function (error, data) {
												result.json({
													"status": "leaved",
													"message": "Group has been left."
												});
											});
									});
							} else {
								const obj = {
									"_id": user._id,
									"name": user.name,
									"profileImage": user.profileImage,
									"status": "Pending"
								}
								database.collection("groups").updateOne({
									"_id": ObjectId(_id)
								}, {
									$push: {
										"members": obj
									}
								}, function (error, data) {

									database.collection("users").updateOne({
										"accessToken": accessToken
									}, {
										$push: {
											"groups": {
												"_id": group._id,
												"name": group.name,
												"coverPhoto": group.coverPhoto,
												"status": "Pending"
											}
										}
									}, function (error, data) {

										database.collection("users").updateOne({
											"_id": group.user._id
										}, {
											$push: {
												"notifications": {
													"_id": ObjectId(),
													"type": "group_join_request",
													"content": user.name + " sent a request to join your group.",
													"profileImage": user.profileImage,
													"groupId": group._id,
													"userId": user._id,
													"status": "Pending",
													"isRead": false,
													"createdAt": new Date().getTime()
												}
											}
										});

										result.json({
											"status": "success",
											"message": "Request to join group has been sent.",
											obj: obj
										});
									});
								});
							}
						}
					});
				}
			});
		});

		app.get("/notifications", function (request, result) {
			result.render("notifications");
		});

		app.post("/acceptRequestJoinGroup", function (request, result) {
			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;
			var groupId = request.fields.groupId;
			var userId = request.fields.userId;

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					database.collection("groups").findOne({
						"_id": ObjectId(groupId)
					}, function (error, group) {
						if (group == null) {
							result.json({
								"status": "error",
								"message": "Group does not exist."
							});
						} else {

							if (group.user._id.toString() != user._id.toString()) {
								result.json({
									"status": "error",
									"message": "Sorry, you do not own this group."
								});
								return;
							}

							database.collection("groups").updateOne({
								$and: [{
									"_id": group._id
								}, {
									"members._id": ObjectId(userId)
								}]
							}, {
								$set: {
									"members.$.status": "Accepted"
								}
							}, function (error, data) {

								database.collection("users").updateOne({
									$and: [{
										"accessToken": accessToken
									}, {
										"notifications.groupId": group._id
									}]
								}, {
									$set: {
										"notifications.$.status": "Accepted"
									}
								}, function (error, data) {

									database.collection("users").updateOne({
										$and: [{
											"_id": ObjectId(userId)
										}, {
											"groups._id": group._id
										}]
									}, {
										$set: {
											"groups.$.status": "Accepted"
										}
									}, function (error, data) {

										result.json({
											"status": "success",
											"message": "Group join request has been accepted."
										});
									});
								});
							});
						}
					});
				}
			});
		});

		app.post("/markNotificationsAsRead", function (request, result) {
			var accessToken = request.fields.accessToken;

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					database.collection("users").updateMany({
						$and: [{
							"accessToken": accessToken
						}, {
							"notifications.isRead": false
						}]
					}, {
						$set: {
							"notifications.$.isRead": true
						}
					}, function (error, data) {
						result.json({
							"status": "success",
							"message": "Notifications has been marked as read."
						});
					});
				}
			});
		});

		app.post("/rejectRequestJoinGroup", function (request, result) {
			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;
			var groupId = request.fields.groupId;
			var userId = request.fields.userId;

			database.collection("users").findOne({
				"accessToken": accessToken
			}, function (error, user) {
				if (user == null) {
					result.json({
						"status": "error",
						"message": "User has been logged out. Please login again."
					});
				} else {

					if (user.isBanned) {
						result.json({
							"status": "error",
							"message": "You have been banned."
						});
						return false;
					}

					database.collection("groups").findOne({
						"_id": ObjectId(groupId)
					}, function (error, group) {
						if (group == null) {
							result.json({
								"status": "error",
								"message": "Group does not exist."
							});
						} else {

							if (group.user._id.toString() != user._id.toString()) {
								result.json({
									"status": "error",
									"message": "Sorry, you do not own this group."
								});
								return;
							}

							database.collection("groups").updateOne({
								"_id": group._id
							}, {
								$pull: {
									"members": {
										"_id": ObjectId(userId)
									}
								}
							}, function (error, data) {

								database.collection("users").updateOne({
									"accessToken": accessToken
								}, {
									$pull: {
										"notifications": {
											"groupId": group._id
										}
									}
								}, function (error, data) {

									database.collection("users").updateOne({
										"_id": ObjectId(userId)
									}, {
										$pull: {
											"groups": {
												"_id": group._id
											}
										}
									}, function (error, data) {

										result.json({
											"status": "success",
											"message": "Group join request has been rejected."
										});
									});
								});
							});
						}
					});
				}
			});
		});

		app.post("/sharePost", async function (request, result) {

			var accessToken = request.fields.accessToken;
			var caption = request.fields.caption ?? ""
			var _id = request.fields._id;
			var type = "shared";
			var createdAt = new Date().getTime();

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return false
			}		

			const post = await database.collection("posts").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Post does not exist."
				})

				return
			}

			const obj = {
				"_id": user._id,
				"name": user.name,
				"username": user.username,
				"profileImage": user.profileImage,
				"createdAt": new Date().getTime()
			}

			await database.collection("posts").updateOne({
				"_id": ObjectId(_id)
			}, {
				$push: {
					"shares": obj
				}
			})

			await database.collection("posts").insertOne({
				"caption": caption == "" ? post.caption : caption,
				"image": post.image,
				"video": post.video,
				"savedPaths": post.savedPaths,
				"youtube_url": post.youtube_url,
				"type": type,
				"createdAt": createdAt,
				"likers": [],
				"comments": [],
				"shares": [],
				link: post.link,
				"user": {
					"_id": user._id,
					"name": user.name,
					"username": user.username,
					"gender": user.gender,
					"profileImage": user.profileImage
				},
				originalPost: {
					_id: post._id,
					user: {
						_id: post.user._id,
						name: post.user.name,
						username: post.user.username
					}
				}
			})

			await database.collection("users").updateOne({
				$and: [{
					"_id": post.user._id
				}, {
					"posts._id": post._id
				}]
			}, {
				$push: {
					"posts.$[].shares": {
						"_id": user._id,
						"name": user.name,
						"profileImage": user.profileImage
					}
				}
			})

			if (user._id.toString() != post.user._id.toString()) {
				if (post.type == "page_post") {
					const page = await database.collection("pages").findOne({
		                _id: post.user._id
		            })

		            if (page != null) {
		            	await database.collection("users").updateOne({
							_id: page.user._id
						}, {
							$push: {
								notifications: {
									_id: ObjectId(),
									type: "post_shared",
									content: user.name + " has shared your post.",
									profileImage: user.profileImage,
									isRead: false,
									post: {
										_id: post._id
									},
									createdAt: new Date().getTime()
								}
							}
						})
		            }
				} else if (post.type == "group_post") {
					await database.collection("users").updateOne({
						"_id": post.uploader._id
					}, {
						$push: {
							"notifications": {
								"_id": ObjectId(),
								"type": "post_shared",
								"content": user.name + " has shared your post.",
								"profileImage": user.profileImage,
								"isRead": false,
								"post": {
									"_id": post._id
								},
								"createdAt": new Date().getTime()
							}
						}
					})
				} else if (post.type == "post") {
					await database.collection("users").updateOne({
						"_id": post.user._id
					}, {
						$push: {
							"notifications": {
								"_id": ObjectId(),
								"type": "post_shared",
								"content": user.name + " has shared your post.",
								"profileImage": user.profileImage,
								"isRead": false,
								"post": {
									"_id": post._id
								},
								"createdAt": new Date().getTime()
							}
						}
					})
				}
			}

			result.json({
				"status": "success",
				"message": "Post has been shared.",
				obj: obj
			})
		})

		app.post("/sharePostInPage", async function (request, result) {
			var accessToken = request.fields.accessToken;
			var pageId = request.fields.pageId;
			var postId = request.fields.postId;
			var type = "page_post";
			var createdAt = new Date().getTime();

			var user = await database.collection("users").findOne({
				"accessToken": accessToken
			});
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				});
				return false;
			}

			var post = await database.collection("posts").findOne({
				"_id": ObjectId(postId)
			});
			if (post == null) {
				result.json({
					"status": "error",
					"message": "Post does not exist."
				});
				return false;
			}

			var page = await database.collection("pages").findOne({
				"_id": ObjectId(pageId)
			});
			if (page == null) {
				result.json({
					"status": "error",
					"message": "Page does not exist."
				});
				return false;
			}

			if (page.user._id.toString() != user._id.toString()) {
				result.json({
					"status": "error",
					"message": "Sorry, you do not own this page."
				});
				return false;
			}

			/* insert in posts nested array */
			await database.collection("posts").findOneAndUpdate({
				"_id": post._id
			}, {
				$push: {
					"shares": {
						"_id": user._id,
						"name": user.name,
						"username": user.username,
						"profileImage": user.profileImage,
						"createdAt": new Date().getTime()
					}
				}
			})

			/* insert new document in posts collection */
			await database.collection("posts").insertOne({
				"caption": post.caption,
				"image": post.image,
				"video": post.video,
				"savedPaths": post.savedPaths,
				"youtube_url": post.youtube_url,
				"type": type,
				"createdAt": createdAt,
				"likers": [],
				"comments": [],
				"shares": [],
				link: post.link,
				"user": {
					"_id": page._id,
					"name": page.name,
					"username": page.username,
					"profileImage": page.coverPhoto
				},
				originalPost: {
					_id: post._id,
					user: {
						_id: post.user._id,
						name: post.user.name,
						username: post.user.username
					}
				}
			})

			result.json({
				"status": "success",
				"message": "Post has been shared in page '" + page.name + "'."
			})
		})

		app.post("/sharePostInGroup", async function (request, result) {

			var accessToken = request.fields.accessToken;
			var groupId = request.fields.groupId;
			var postId = request.fields.postId;
			var type = "group_post";
			var createdAt = new Date().getTime();

			var user = await database.collection("users").findOne({
				"accessToken": accessToken
			});
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				});
				return false;
			}

			var post = await database.collection("posts").findOne({
				"_id": ObjectId(postId)
			});
			if (post == null) {
				result.json({
					"status": "error",
					"message": "Post does not exist."
				});
				return false;
			}

			var group = await database.collection("groups").findOne({
				"_id": ObjectId(groupId)
			});
			if (group == null) {
				result.json({
					"status": "error",
					"message": "Group does not exist."
				});
				return false;
			}

			var isMember = false;
			for (var a = 0; a < group.members.length; a++) {
				var member = group.members[a];

				if (member._id.toString() == user._id.toString() && member.status == "Accepted") {
					isMember = true;
					break;
				}
			}

			if (!isMember) {
				result.json({
					"status": "error",
					"message": "Sorry, you are not a member of this group."
				});
				return false;
			}

			/* insert in posts nested array */
			await database.collection("posts").findOneAndUpdate({
				"_id": post._id
			}, {
				$push: {
					"shares": {
						"_id": user._id,
						"name": user.name,
						"username": user.username,
						"profileImage": user.profileImage,
						"createdAt": new Date().getTime()
					}
				}
			});

			/* insert new document in posts collection */
			await database.collection("posts").insertOne({
				"caption": post.caption,
				"image": post.image,
				"video": post.video,
				"savedPaths": post.savedPaths,
				"youtube_url": post.youtube_url,
				"type": type,
				"createdAt": createdAt,
				"likers": [],
				"comments": [],
				"shares": [],
				link: post.link,
				"user": {
					"_id": group._id,
					"name": group.name,
					"username": group.name,
					"profileImage": group.coverPhoto
				},
				"uploader": {
					"_id": user._id,
					"name": user.name,
					"username": user.username,
					"profileImage": user.profileImage
				},
				originalPost: {
					_id: post._id,
					user: {
						_id: post.user._id,
						name: post.user.name,
						username: post.user.username
					}
				}
			});

			result.json({
				"status": "success",
				"message": "Post has been shared in group '" + group.name + "'."
			});
		});

		app.post("/getPostById", async function (request, result) {
			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;

			var user = await database.collection("users").findOne({
				"accessToken": accessToken
			});

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				});
				return false;
			}

			var post = await database.collection("posts").findOne({
				"_id": ObjectId(_id)
			});

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Post does not exist."
				});
				return false;
			}

			result.json({
				"status": "success",
				"message": "Data has been fetched.",
				"post": post
			});
		});

		app.post("/editPost", async function (request, result) {
			editPost.execute(request, result);
		});

		app.post("/deletePost", async function (request, result) {
			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;

			var user = await database.collection("users").findOne({
				"accessToken": accessToken
			});

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				});
				return false;
			}

			var post = await database.collection("posts").findOne({
				"_id": ObjectId(_id)
			});

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Post does not exist."
				});
				return false;
			}

			var isMyUploaded = false;

			if (post.type == "group_post") {
				isMyUploaded = (post.uploader._id.toString() == user._id.toString());
			} else {
				isMyUploaded = (post.user._id.toString() == user._id.toString());
			}

			if (!isMyUploaded) {
				result.json({
					"status": "error",
					"message": "Sorry, you do not own this post."
				});
				return false;
			}

			if (post.savedPaths != null) {
				for (let a = 0; a < post.savedPaths.length; a++) {
					fileSystem.unlink(post.savedPaths[a], function (error) {
						if (error) {
							console.error(error)
						}
					})
				}
			}

			if (post.image) {
				fileSystem.unlink(post.image, function (error) {
					if (error) {
						console.error(error)
					}
				})
			}

			if (post.video) {
				fileSystem.unlink(post.video, function (error) {
					if (error) {
						console.error(error)
					}
				})
			}

			if (post.audio) {
				fileSystem.unlink(post.audio, function (error) {
					if (error) {
						console.error(error)
					}
				})
			}

			if (post.document) {
				fileSystem.unlink(post.document, function (error) {
					if (error) {
						console.error(error)
					}
				})
			}

			await database.collection("posts").deleteOne({
				_id: post._id
			})

			result.json({
				status: "success",
				message: "Post has been deleted."
			})
		})

		app.post("/fetch-more-posts", async function (request, result) {
			var accessToken = request.fields.accessToken;
			var start = parseInt(request.fields.start);

			var user = await database.collection("users").findOne({
				"accessToken": accessToken
			});

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				});
				return false;
			}

			var ids = [];
			ids.push(user._id);

			for (var a = 0; a < user.pages.length; a++) {
				ids.push(user.pages[a]._id);
			}

			for (var a = 0; a < user.groups.length; a++) {
				if (user.groups[a].status == "Accepted") {
					ids.push(user.groups[a]._id);
				}
			}

			for (var a = 0; a < user.friends.length; a++) {
	            if (user.friends[a].status == "Accepted") {
					ids.push(user.friends[a]._id);
	            }
			}

			const posts = await database.collection("posts")
				.find({
					"user._id": {
						$in: ids
					}
				})
				.sort({
					"createdAt": -1
				})
				.skip(start)
				.limit(5)
				.toArray();

			result.json({
				"status": "success",
				"message": "Record has been fetched",
				"data": posts
			});
		});

		app.post("/showStoryDislikers", async function (request, result) {
			var accessToken = request.fields.accessToken
			var _id = request.fields._id

			var user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return false
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return false
			}

			var post = await database.collection("stories").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Story does not exist."
				})

				return false
			}

			if (post.user._id.toString() != user._id.toString()) {
				result.json({
					"status": "error",
					"message": "Unauthorized."
				})

				return
			}

			const dislikers = post.dislikers || []

			result.json({
				"status": "success",
				"message": "Data has been fetched.",
				"data": dislikers
			})
		})

		app.post("/fetchPostDisLikers", async function (request, result) {
			var accessToken = request.fields.accessToken
			var _id = request.fields._id

			var user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return false
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return false
			}

			var post = await database.collection("posts").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Post does not exist."
				})

				return false
			}

			const dislikers = post.dislikers || []
			for (const liker of dislikers) {
				if (liker.profileImage != "") {
					liker.profileImage = mainURL + "/" + liker.profileImage
				}
			}

			result.json({
				"status": "success",
				"message": "Data has been fetched.",
				"data": dislikers
			})
		})

		app.post("/showStoryLikers", async function (request, result) {
			var accessToken = request.fields.accessToken
			var _id = request.fields._id

			var user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return false
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return false
			}

			var post = await database.collection("stories").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Story does not exist."
				})

				return false
			}

			if (post.user._id.toString() != user._id.toString()) {
				result.json({
					"status": "error",
					"message": "Unauthorized."
				})

				return
			}

			const likers = post.likers || []

			result.json({
				"status": "success",
				"message": "Data has been fetched.",
				"data": likers
			})
		})

		app.post("/fetchPostLikers", async function (request, result) {
			var accessToken = request.fields.accessToken
			var _id = request.fields._id

			var user = await database.collection("users").findOne({
				"accessToken": accessToken
			})

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				})

				return false
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				})

				return false
			}

			var post = await database.collection("posts").findOne({
				"_id": ObjectId(_id)
			})

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Post does not exist."
				})

				return false
			}

			const likers = post.likers || []
			for (const liker of likers) {
				if (liker.profileImage != "") {
					liker.profileImage = mainURL + "/" + liker.profileImage
				}
			}

			result.json({
				"status": "success",
				"message": "Data has been fetched.",
				"data": likers
			})
		})

		app.post("/fetchPostSharers", async function (request, result) {
			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;

			var user = await database.collection("users").findOne({
				"accessToken": accessToken
			});

			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}

			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				});
				return false;
			}

			var post = await database.collection("posts").findOne({
				"_id": ObjectId(_id)
			});

			if (post == null) {
				result.json({
					"status": "error",
					"message": "Post does not exist."
				});
				return false;
			}

			const shares = post.shares
			for (const s of shares) {
				if (s.profileImage != "") {
					s.profileImage = mainURL + "/" + s.profileImage
				}
			}

			result.json({
				"status": "success",
				"message": "Data has been fetched.",
				"data": shares
			});
		});

		app.get("/customer-support", function (request, result) {
			result.render("customer-support");
		});

		app.post("/createTicket", async function (request, result) {
			var accessToken = request.fields.accessToken;
			const description = request.fields.description;
			var image = "";
			var video = "";
			const comments = [];
			var createdAt = new Date().getTime();

			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			});
			
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}
			
			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				});
				return false;
			}

			if (request.files.image.size > 0 && request.files.image.type.includes("image")) {
				image = "public/images/ticket-" + new Date().getTime() + "-" + request.files.image.name;

				// Read the file
				fileSystem.readFile(request.files.image.path, function (err, data) {
					if (err) throw err;
					console.log('File read!');

					// Write the file
					fileSystem.writeFile(image, data, function (err) {
						if (err) throw err;
						console.log('File written!');
					});

					// Delete the file
					fileSystem.unlink(request.files.image.path, function (err) {
						if (err) throw err;
						console.log('File deleted!');
					});
				});
			}

			if (request.files.video.size > 0 && request.files.video.type.includes("video")) {
				video = "public/videos/ticket-" + new Date().getTime() + "-" + request.files.video.name;

				// Read the file
				fileSystem.readFile(request.files.video.path, function (err, data) {
					if (err) throw err;
					console.log('File read!');

					// Write the file
					fileSystem.writeFile(video, data, function (err) {
						if (err) throw err;
						console.log('File written!');
					});

					// Delete the file
					fileSystem.unlink(request.files.video.path, function (err) {
						if (err) throw err;
						console.log('File deleted!');
					});
				});
			}

			const ticket = await database.collection("tickets").insertOne({
				"description": description,
				"user": {
					"_id": user._id,
					"name": user.name,
					"username": user.username,
					"profileImage": user.profileImage
				},
				"image": image,
				"video": video,
				"status": "open", // closed
				"comments": comments,
				"createdAt": createdAt
			});

			result.json({
				"status": "success",
				"message": "Ticket has been created. We will respond to your request soon.",
				"ticket": ticket.ops[0]
			});
		});

		app.post("/getMyAllTickets", async function (request, result) {
			var accessToken = request.fields.accessToken;
			
			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			});
			
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}
			
			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				});
				return false;
			}

			var data = await database.collection("tickets").find({
				"user._id": user._id
			}).toArray();

			data = data.reverse();

			result.json({
				"status": "success",
				"message": "Data has been fetched.",
				"data": data
			});
		});

		app.get("/editTicket/:_id", async function (request, result) {
			result.render("editTicket", {
				"_id": request.params._id
			});
		});

		app.post("/getTicket", async function (request, result) {
			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;
			
			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			});
			
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}
			
			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				});
				return false;
			}

			const data = await database.collection("tickets").findOne({
				$and: [{
					"_id": ObjectId(_id)
				}, {
					"user._id": user._id
				}]
			});

			if (data == null) {
				result.json({
					"status": "error",
					"message": "Sorry, you are not the owner of this ticket."
				});
				return false;
			}

			result.json({
				"status": "success",
				"message": "Data has been fetched.",
				"data": data
			});
		});

		app.post("/editTicket/:_id", async function (request, result) {

			var accessToken = request.fields.accessToken;
			var _id = request.params._id;
			var description = request.fields.description;
			var image = "";
			var video = "";
			
			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			});
			
			if (user == null) {
				result.render("editTicket", {
					"_id": request.params._id,
					"status": "error",
					"message": "User has been logged out. Please login again."
				});

				return false;
			}
			
			if (user.isBanned) {
				result.render("editTicket", {
					"_id": request.params._id,
					"status": "error",
					"message": "You have been banned."
				});

				return false;
			}

			const data = await database.collection("tickets").findOne({
				$and: [{
					"_id": ObjectId(_id)
				}, {
					"user._id": user._id
				}]
			});

			if (data == null) {
				result.render("editTicket", {
					"_id": request.params._id,
					"status": "error",
					"message": "Sorry, you are not the owner of this ticket."
				});

				return false;
			}

			image = data.image;
			video = data.video;

			if (request.files.image.size > 0 && request.files.image.type.includes("image")) {
				image = "public/images/ticket-" + new Date().getTime() + "-" + request.files.image.name;

				fileSystem.unlink(data.image, function (error) {
					console.log("Preview image has been deleted: " + error);
				});

				// Read the file
				fileSystem.readFile(request.files.image.path, function (err, data) {
					if (err) throw err;
					console.log('File read!');

					// Write the file
					fileSystem.writeFile(image, data, function (err) {
						if (err) throw err;
						console.log('File written!');
					});

					// Delete the file
					fileSystem.unlink(request.files.image.path, function (err) {
						if (err) throw err;
						console.log('File deleted!');
					});
				});
			}

			if (request.files.video.size > 0 && request.files.video.type.includes("video")) {
				video = "public/videos/ticket-" + new Date().getTime() + "-" + request.files.video.name;

				fileSystem.unlink(data.video, function (error) {
					console.log("Preview video has been deleted: " + error);
				});

				// Read the file
				fileSystem.readFile(request.files.video.path, function (err, data) {
					if (err) throw err;
					console.log('File read!');

					// Write the file
					fileSystem.writeFile(video, data, function (err) {
						if (err) throw err;
						console.log('File written!');
					});

					// Delete the file
					fileSystem.unlink(request.files.video.path, function (err) {
						if (err) throw err;
						console.log('File deleted!');
					});
				});
			}

			await database.collection("tickets").findOneAndUpdate({
				$and: [{
					"_id": ObjectId(_id)
				}, {
					"user._id": user._id
				}]
			}, {
				$set: {
					"description": description,
					"image": image,
					"video": video
				}
			});

			result.render("editTicket", {
				"_id": request.params._id,
				"status": "success",
				"message": "Ticket has been updated."
			});
		});

		app.post("/deleteTicket", async function (request, result) {
			var accessToken = request.fields.accessToken;
			var _id = request.fields._id;
			
			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			});
			
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});
				return false;
			}
			
			if (user.isBanned) {
				result.json({
					"status": "error",
					"message": "You have been banned."
				});
				return false;
			}

			const data = await database.collection("tickets").findOne({
				$and: [{
					"_id": ObjectId(_id)
				}, {
					"user._id": user._id
				}]
			});

			if (data == null) {
				result.json({
					"status": "error",
					"message": "Sorry, you are not the owner of this ticket."
				});
				return false;
			}

			if (data.image != "") {
				fileSystem.unlink(data.image, function (error) {
					console.log("Preview image has been deleted: " + error);
				});
			}

			if (data.video != "") {
				fileSystem.unlink(data.video, function (error) {
					console.log("Preview video has been deleted: " + error);
				});
			}

			await database.collection("tickets").findOneAndDelete({
				$and: [{
					"_id": ObjectId(_id)
				}, {
					"user._id": user._id
				}]
			});

			result.json({
				"status": "success",
				"message": "Ticket has been deleted."
			});
		});

		app.get("/tickets/detail/:_id", function (request, result) {
            const _id = request.params._id;

            result.render("tickets/detail", {
                "_id": _id
            });
        });
		
		app.post("/tickets/add-comment", async function (request, result) {
            var accessToken = request.fields.accessToken;
			var _id = request.fields._id;
			var comment = request.fields.comment;
			
			const user = await database.collection("users").findOne({
				"accessToken": accessToken
			});
			
			if (user == null) {
				result.json({
					"status": "error",
					"message": "User has been logged out. Please login again."
				});

				return false;
			}

            const data = await database.collection("tickets").findOne({
				$and: [{
					"_id": ObjectId(_id)
				}, {
					"user._id": user._id
				}]
			});

			if (data == null) {
				result.json({
					"status": "error",
					"message": "Sorry, you do not own this ticket."
				});

				return false;
			}

            if (data.status == "closed") {
                result.json({
					"status": "error",
					"message": "Sorry, the ticket is closed."
				});

				return false;
            }

            const commentObj = {
                "_id": ObjectId(),
                "user": {
                    "_id": user._id,
                    "name": user.name,
                    "username": user.username,
                    "profileImage": user.profileImage
                },
                "comment": comment,
                "createdAt": new Date().getTime()
            };

            await database.collection("tickets").findOneAndUpdate({
				$and: [{
					"_id": ObjectId(_id)
				}, {
					"user._id": user._id
				}]
			}, {
				$push: {
					"comments": commentObj
				}
			});

            // send notification to the admin
            /*self.database.collection("users").updateOne({
                "_id": data.user._id
            }, {
                $push: {
                    "notifications": {
                        "_id": self.ObjectId(),
                        "type": "comment_on_ticket",
                        "content": "You have a new comment on your <a href='" + mainURL + "/tickets/detail/" + data._id + "' class='notification-link'>ticket</a>.",
                        "profileImage": "",
                        "isRead": false,
                        "createdAt": new Date().getTime()
                    }
                }
            });*/

            result.json({
                "status": "success",
				"message": "Comment has been added.",
                "comment": commentObj
            });
        });

	});
});