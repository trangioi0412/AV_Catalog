import nodemailer from "nodemailer";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    console.warn("SMTP credentials not fully configured. Email notifications will be skipped.");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: port === "465", // true for 465, false for other ports
    auth: {
      user,
      pass,
    },
  });
}

export async function sendNewProductsEmail(
  discoveredProducts: Array<{ brandName: string; product: string; title: string; category: string }>
): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) return false;

  const count = discoveredProducts.length;
  if (count === 0) return false;

  const recipient = "trangioi479@gmail.com";

  // Build the email body
  const rowsHtml = discoveredProducts
    .map(
      (p, i) => `
    <tr style="background-color: ${i % 2 === 0 ? "#f9f9f9" : "#ffffff"}; border-bottom: 1px solid #eeeeee;">
      <td style="padding: 12px; font-family: sans-serif; font-size: 14px; color: #333333;"><strong>${p.brandName}</strong></td>
      <td style="padding: 12px; font-family: sans-serif; font-size: 14px; color: #333333;">${p.category}</td>
      <td style="padding: 12px; font-family: sans-serif; font-size: 14px; color: #333333;"><strong>${p.product}</strong></td>
      <td style="padding: 12px; font-family: sans-serif; font-size: 14px; color: #333333;">${p.title}</td>
    </tr>
  `
    )
    .join("");

  const html = `
    <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; font-family: sans-serif;">
      <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 20px; border-radius: 6px 6px 0 0; text-align: center; color: white;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 700;">New Products Discovered</h1>
        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Product Discovery & Sync Engine</p>
      </div>
      
      <div style="padding: 20px;">
        <p style="font-size: 16px; line-height: 1.5; color: #555555;">
          The automated scan has completed and discovered <strong>${count}</strong> new product(s) awaiting approval in the queue.
        </p>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr style="background-color: #f3f4f6; border-bottom: 2px solid #e5e7eb; text-align: left;">
              <th style="padding: 12px; font-family: sans-serif; font-size: 14px; font-weight: 600; color: #4b5563;">Brand</th>
              <th style="padding: 12px; font-family: sans-serif; font-size: 14px; font-weight: 600; color: #4b5563;">Category</th>
              <th style="padding: 12px; font-family: sans-serif; font-size: 14px; font-weight: 600; color: #4b5563;">Product</th>
              <th style="padding: 12px; font-family: sans-serif; font-size: 14px; font-weight: 600; color: #4b5563;">Title</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        
        <div style="margin-top: 30px; text-align: center;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/admin/discovery" 
             style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; box-shadow: 0 4px 6px rgba(59, 130, 246, 0.2);">
            Review in Discovery Queue
          </a>
        </div>
      </div>
      
      <div style="border-top: 1px solid #e0e0e0; padding-top: 15px; margin-top: 20px; text-align: center; font-size: 12px; color: #999999;">
        This is an automated notification. Please do not reply to this email.
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"AV Catalog Discovery" <${process.env.SMTP_USER}>`,
      to: recipient,
      subject: `[AV Catalog] ${count} New Product(s) Discovered Awaiting Approval`,
      html,
    });
    return true;
  } catch (err) {
    console.error("Failed to send discovery email:", err);
    return false;
  }
}
