from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from dotenv import load_dotenv
import google.generativeai as genai

# Load environment variables from a .env file
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes, allowing your frontend to connect

# Configure the Gemini API client
try:
    # It's good practice to configure the client once when the app starts
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Warning: GEMINI_API_KEY environment variable not set.")
        print("Please set your Gemini API key in a .env file")
    genai.configure(api_key=api_key)
except Exception as e:
    print(f"Error configuring Google AI client: {e}")


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint to confirm the server is running."""
    return jsonify({"status": "healthy", "message": "Flask server is running"})

@app.route('/generate-website', methods=['POST'])
def generate_website():
    """Endpoint to generate a website using the Gemini API."""
    try:
        data = request.get_json()
        user_prompt = data.get('prompt', '')
        
        if not user_prompt:
            return jsonify({"error": "A prompt is required to generate the website."}), 400
        
        # A detailed and robust prompt to guide the AI model
        enhanced_prompt = f"""
        You are an expert web developer. Your task is to create a complete, single-file, responsive HTML website based on the user's request.

        User Request: "{user_prompt}"
        
        **CRITICAL REQUIREMENTS:**


        1.  **Aesthetic Excellence & Modern Design:**
            * **Design:** Create a clean, elegant, and professional design. Pay meticulous attention to spacing (padding/margins), alignment, and visual hierarchy. The layout should feel spacious and uncluttered.
            * **Color Palette:** Use a sophisticated and harmonious color palette. Think about modern web trends. Use tools like Coolors or Adobe Color for inspiration if needed. Ensure high contrast for readability.
            * **Typography:** Choose modern and readable web fonts. You can import them from Google Fonts directly in the `<style>` tag (e.g., using `@import url(...)`).
            * **Interactivity:** Incorporate subtle CSS animations, transitions, and hover effects to make the page feel dynamic and responsive. This is key to a premium feel.
            * **Imagery:** Use high-quality inline SVGs for icons and logos. For placeholder images, use visually appealing, high-resolution images from a service like Pexels or Unsplash.
            * **Tabs:** Place various sections of the website in tabs to enhance organization and user experience. Ensure the tabs are easy to navigate and visually distinct where the tabs are to be placed in a proper navbar and must be responsive.
            * ** The tabs in the landing page should be accessible and should be easy to navigate.**
            * ** The tabs should navigate to the respective sections of the website.**
            * ** Add a lot of content in the tabs to make the website look complete and professional.**
            * ** Make sure that every page in the website is properly linked to the navbar.**

        2.  **Technical Specifications:**
            * **Single HTML File:** Generate a complete HTML document. All CSS and JavaScript MUST be embedded where the tabs in the navbar are correctly navigated.
            * **Embedded CSS:** Place ALL CSS in a `<style>` tag in the `<head>`.
            * **Tailwind CSS:** You MUST include the Tailwind CSS CDN (`<script src="https://cdn.tailwindcss.com"></script>`) in the `<head>`. Use Tailwind classes extensively and expertly.
            * **Responsiveness:** The layout must be flawless on mobile, tablet, and desktop screens. Test your design mentally at different breakpoints.
            * **Semantic HTML:** Use modern HTML5 elements (`<header>`, `<nav>`, `<main>`, `<section>`, `<footer>`, etc.).
            * **Clean Output:** Return ONLY the raw HTML code. Do not wrap it in markdown formatting (like ```html ... ```) or add any explanatory text outside the HTML itself.
        
        3. Images in code :
            1. You can put images in the code if you think it really adds on to the look of the frontend .
            2. Use placeholder images from https://picsum.photos/width/height. These images will be replaced by a separate system in production. Your only responsibility is to provide a URL with appropriate width and height.
            3. Our System can even apply two filters grayscale and blur if required you can use them. Below is the example usage of how to use it
            4. Example URLS :
                > "https://picsum.photos/200/300" -- This will give a image of width 200px and height 300px
                > "https://picsum.photos/200/300?grayscale" -- This will give a image of width 200px and height 300px with grayscale filter applied
                > "https://picsum.photos/200/300/?blur=5 -- This will give a image of width 200px and height 300px with blur filter applied

        4. Content:
            * ** The content of the website should be based on the user request.**
            * ** Do not use any lorem ipsum or placeholder text. The content should be relevant to the user request.**
            * ** Do not use any placeholder images. The images should be relevant to the user request.**
            * ** If the images are used make sure that they fit exactly in case of design, size and theme.**
            * ** Make sure that there are various sections in the website like header, footer, main content, sidebar, etc.**
            * ** All the sections should be properly aligned and spaced.**
            * ** The content should be relavant and interesting.** 
            * ** The pages should have a lot of relevant content such that they occupy the complete height and width of the screen.**
            * ** Add slider, toggle group, dropdown, hover card, Combobox, and other interactive elements to enhance the user experience whenever required.**
            * ** Add animations and transitions to the elements to make the website more interactive and engaging.**

        5. Footer:
            * ** The footer should contain relavant links of the tabs generated. **
            * ** The tabs in the footer must be accessible and should be easy to navigate.**
            * ** The footer should be visually appealing and should match the overall design of the website.**
        """
        
        # Initialize the generative model
        model = genai.GenerativeModel("gemini-1.5-flash-latest")
        
        # Generate content using streaming for better performance
        # We removed the explicit GenerationConfig as the default response type is 'text/plain',
        # which is what we need. This avoids library version conflicts.
        response_stream = model.generate_content(
            contents=[enhanced_prompt],
            stream=True
        )
        
        generated_html = ""
        for chunk in response_stream:
            # Ensure chunk has text before appending
            if chunk.text:
                generated_html += chunk.text
        
        # A more robust way to clean up potential markdown formatting from the response
        if generated_html.strip().startswith('```html'):
            generated_html = generated_html.strip()[7:] # Remove ```html
            if generated_html.strip().endswith('```'):
                generated_html = generated_html.strip()[:-3] # Remove ```
        
        return jsonify({
            "success": True,
            "html": generated_html.strip(),
            "message": "Website generated successfully"
        })
        
    except Exception as e:
        # Log the full error for easier debugging on the server side
        print(f"Error during website generation: {e}")
        # Return a helpful error message to the client
        return jsonify({
            "success": False,
            "error": f"An internal server error occurred. Please check the server logs. Details: {str(e)}"
        }), 500

if __name__ == '__main__':
    # The app runs in debug mode, which is great for development.
    # For production, consider using a more robust WSGI server like Gunicorn.
    app.run(debug=True, host='0.0.0.0', port=5000)
 