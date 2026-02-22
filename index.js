const express=require('express')
const cors=require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto=require("crypto")
const admin = require("firebase-admin");

const serviceAccount = require("./zap-shift-firebase-adminsdk-fbsvc.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


const app=express()
const port=process.env.PORT || 3000
//middleware
const verifyFbToken=async(req,res,next)=>{
    const token=req.headers.authorization
    
    if(!token){
        return res.status(401).send({message:'unauthorize access'})
    }
  //firebase verify 
    try{
    const idToken=token.split(' ')[1];
    const decoded=await admin.auth().verifyIdToken(idToken)
    console.log( 'decoded in the tokken',decoded);
    req.decoded_email=decoded.email
    next()
    
    }
    catch(err){
        return res.status(410).send({message:'unauthorized access'})

    }

    
    

}


//generate traking id
function generateTrakingId(){
    const prefix='PRCL';//your brand prefix
    const date=new Date().toISOString().slice(0,10).replace(/-/g,""); //YYYYMMDD
    const random =crypto.randomBytes(3).toString("hex").toUpperCase(); //6-char random hex

    return `${prefix}-${date}-${random}`
}
// middle ware
app.use(express.json())
app.use(cors())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.0nerjvp.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run(){

    try {
    await client.connect();

    // create database
    const db=client.db('zap_shift_db')
    const parcelsCollection=db.collection('parcels')
    const paymentCollection=db.collection('payments')
    const userCollection=db.collection('users')
    const ridersCollection=db.collection('riders')

    //middleware with database access
    //must be use after firebase varify token na hole decorded email ta pabo na 
    const verifyAdmin=async(req,res,next)=>{
        const email=req.decoded_email
        const query={email}
        const user=await userCollection.findOne(query)

        if(!user || user.role !== 'admin'){
            return res.status(403).send({message : 'forbidden access'})
        }

        next()

    }

    //user releted apis
    app.get('/users', verifyFbToken,async(req,res)=>{

      const searchText=req.query.searchText;
      const query={}
      if(searchText){
        // query.displayName=searchText
        // query.displayName={$regex:searchText,options:'i'}

        query.$or=[
            {displayName:{$regex:searchText,$options:'i'}},
            {email:{$regex:searchText,$options:'i'}}

        ]
      }

        const cursor=userCollection.find(query).sort({createdAt:-1}).limit(5)
        const result=await cursor.toArray()
        res.send(result)
    })

    app.get('/users/:id',async(req,res)=>{

    })

    app.get('/users/:email/role',async(req,res)=>{
        const email=req.params.email
        const query={email}
        const user=await userCollection.findOne(query)
        res.send({role:user?.role || 'user'})

    })
    app.post('/users',async(req,res)=>{
        const user=req.body
        user.role='user'
        user.createdAt=new Date()
        const email=user.email

        const userExist=await userCollection.findOne({email})

        if(userExist){
            res.send({message:'user already exist '})
        }


        const result=await userCollection.insertOne(user)
        res.send(result)
    })

    app.patch('/users/:id/role',verifyFbToken,verifyAdmin,async(req,res)=>{
        const id=req.params.id
        const roleInfo=req.body
        const query={_id:new ObjectId(id)}
        const updatedDoc={
            $set:{
                role:roleInfo.role
            }
        }
        const result=await userCollection.updateOne(query,updatedDoc)
        res.send(result)
    })

    // parcel api
    app.get('/parcels',async(req,res)=>{
        const query={}

        const {email,delivaryStatus}=req.query
        if(email){
           
            query.senderEmail=email;

        }
        if(delivaryStatus){
            query.delivaryStatus=delivaryStatus
        }
        const options={sort: {createdAt:-1}}
        const cursor=parcelsCollection.find(query,options)
        const result=await cursor.toArray()
        res.send(result)
    })

    app.get('/parcels/rider',async(req,res)=>{
        const {riderEmail,deliveryStatus}=req.query
        const query={}
        if(query){
            query.riderEmail=riderEmail
        }
        if(deliveryStatus){
            query.deliveryStatus={$in:['driver_assigned','rider-arriving']}
        }
        const cursor=parcelsCollection.find(query)
        const result=await cursor.toArray()
        res.send(result)

    })

    app.get('/parcels/:id',async(req,res)=>{
        const id=req.params.id;
        const query={_id :new ObjectId(id)}
        const result=await parcelsCollection.findOne(query)
        res.send(result)
    })

    app.post('/parcels',async(req,res)=>{
        const parcel=req.body;
        // parcel created time
        parcel.createdAt=new Date()
        const result= await parcelsCollection.insertOne(parcel)
        res.send(result)
        
    })

    app.delete('/parcels/:id',async(req,res)=>{
        const id =req.params.id
        const query={_id:new ObjectId(id)}
        const result=await parcelsCollection.deleteOne(query)
        res.send(result)

    })

    app.patch('/parcels/:id',async(req,res)=>{
        const {riderId,riderName,riderEmail}=req.body
        const id =req.params.id
        const query={_id:new ObjectId(id)}

        const updatedDoc={
            $set:{
                delivaryStatus:'driver_assigned',
                riderId:riderId,
                riderName:riderName,
                riderEmail:riderEmail

            }
        }
        const result=await parcelsCollection.updateOne(query,updatedDoc)

        // update rider
        const riderQuery={_id:new ObjectId(riderId)}
        const riderUpdatedDoc={
            $set:{
                workStatus:'in_Delivary'
            }
        }
        const riderResult=await ridersCollection.updateOne(riderQuery,riderUpdatedDoc)

        res.send(riderResult)
    })

    app.patch('/parcels/:id/status',async(req,res)=>{
        const {deliveryStatus}=req.body
        const query={_id:new ObjectId(req.params.id)}
        const updatedDoc={
            $set:{
                deliveryStatus:deliveryStatus
            }
        }
        const result=await parcelsCollection.updateOne(query,updatedDoc)
        res.send(result)


    })



    //payment releted apis
    app.post('/create-chechout-session',async(req,res)=>{
        const paymentInfo=req.body
        const amount=parseInt(paymentInfo.cost)*100
        const session=await stripe.checkout.sessions.create({
    line_items: [
      {
        price_data:{

            currency:'USD',
             unit_amount:amount,
            product_data:{
                name:paymentInfo.parcelName,
            },
           
        },
        
        quantity: 1,
      },
    ],
    customer_email:paymentInfo.senderEmail,
    mode: 'payment',
    metadata:{
        parcelId:paymentInfo.parcelId,
        parcelName:paymentInfo.parcelName

    },
    success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
  });

  res.send({ url : session.url})
    })



    app.patch('/payment-success', async (req, res) => {
    try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        
        // jate double data na jay ai jonne
        const transactionId=session.payment_intent
        const query={transactionId}

        const paymentExist=await paymentCollection.findOne(query)
        if(paymentExist){
            return res.send({
                message:'already exist',
                transactionId,
               
                trakingId:paymentExist.trakingId
            })
        }

        const trakingId=generateTrakingId()
        if (session.payment_status === 'paid') {
            const id = session.metadata.parcelId;
            const query = { _id: new ObjectId(id) };
            const update = {
                $set: {
                     paymentStatus: 'paid',
                      delivaryStatus:'pending-pickup',
                     trakingId:trakingId
                    } 
            };
            const result = await parcelsCollection.updateOne(query, update);
            
            //payment history page ar jonno session theke data niye object create kortesi??
            const payment={
                amount:session.amount_total/100,
                currency:session.currency,
                customerEmail:session.customer_email,
                parcelId:session.metadata.parcelId,
                parcelName:session.metadata.parcelName,
                transactionId:session.payment_intent,
                paymentStatus:session.payment_status,
                paidAt:new Date(),
                trakingIde:trakingId
                
            }
            if(session.payment_status === 'paid'){
                const resultPayment=await paymentCollection.insertOne(payment)
                res.send({
                    success:true,
                     modifyParcel:result,
                     paymentInfo:resultPayment,
                     trakingId:trakingId,
                     transactionId:session.payment_intent,
                    })

            }
           
        }

        res.status(400).send({ success: false, message: "Payment not verified" });
    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

// payment releted apis 
app.get('/payments',verifyFbToken, async(req,res)=>{
    const email=req.query.email
    const query={}
    
    if(email){
        query.customerEmail=email

        //check email adress
        if(email !==req.decoded_email){
            return res.status(403).send({message:"forbidden access"})
        }

    }
    const cursor=paymentCollection.find(query).sort({paidAt:-1})
    const result =await cursor.toArray(cursor)
    res.send(result)
})

//riders releted apis
app.get('/riders',async(req,res)=>{
    const {status,district,workStatus}=req.query
    const query={}
    if(req.query.status){
        query.status=status
    }
    if(district){
        query.district=district
    }
    if(workStatus){
        query.workStatus=workStatus
    }
    const cursor=ridersCollection.find(query)
    const result=await cursor.toArray()
    res.send(result)
})
app.post('/riders',async(req,res)=>{
    const rider=req.body
    rider.status='pending'
    rider.createdAt=new Date()
    const result=await ridersCollection.insertOne(rider)
    res.send(result)
})

app.patch(`/riders/:id`,verifyFbToken,verifyAdmin, async(req,res)=>{
    const status=req.body.status
    const id=req.params.id
    const query={_id:new ObjectId(id)}
    const updatedDoc={
        $set:{
            status:status,
            workStatus: 'available'

        }
    }
    const result=await ridersCollection.updateOne(query,updatedDoc)

    if(status === 'approved'){
        const email=req.body.email
        const userQuery={email}
        const updateUser={
            $set:{
                role:'rider'
            }
            
        }
        const userResult=await userCollection.updateOne(userQuery,updateUser)
    }
    res.send(result)

})



    
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
   
    // await client.close();
  }

}
run().catch(console.dir)

app.get('/',(req,res)=>{
    res.send('my server is running')
})

app.listen(port,()=>{
    console.log(`my zap shift project running on server to ${port}`);
    
})